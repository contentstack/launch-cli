import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { answerPrompts, onTerminal } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

import getFixture from '../fixtures/environment-get.json';
import projectFixture from '../fixtures/project-get.json';
import uploadProjectFixture from '../fixtures/project-get-fileupload.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const ENV_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`;
const DATA_DIR = tmpdir();

const CONFIG: Record<string, unknown> = {
  authorisationType: 'BASIC',
  authtoken: 'test-authtoken',
  email: 'cli-user@example.test',
  region: {
    name: 'integration',
    cma: 'https://cma.integration.test',
    cda: 'https://cda.integration.test',
    uiHost: 'https://app.integration.test',
    launchHubUrl: LAUNCH_HUB_URL,
  },
};

let config: Interfaces.Config;
let onWire: string[];

function updateArgs(...extra: string[]): string[] {
  return ['launch:env:update', '--org', ORG_UID, '--project', PROJECT_UID, '--env', ENV_UID, '--data-dir', DATA_DIR, ...extra];
}

function reads(project: unknown = projectFixture) {
  return [
    nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).reply(200, project as nock.Body),
    nock(LAUNCH_HUB_URL).get(ENV_PATH).reply(200, getFixture),
  ];
}

function update(sent: unknown[], status = 200, reply: unknown = getFixture) {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('content-type', 'application/json')
    .put(ENV_PATH, (body: unknown) => {
      sent.push(body);
      return true;
    })
    .reply(status, reply as nock.Body);
}

describe('integration: launch:env:update on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    onWire = [];
    nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
      onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
    });
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('reads the project and environment, then PUTs only the supplied fields', async () => {
    const sent: unknown[] = [];
    const [project, environment] = reads();
    const put = update(sent);

    const { error, stdout } = await runCommand(
      updateArgs('--name', 'renamed', '--res-mode', 'streaming', '--cs-auth', 'disable'),
      config,
    );

    expect(error).toBeUndefined();
    expect([project.isDone(), environment.isDone(), put.isDone()]).toEqual([true, true, true]);
    expect(sent).toEqual([{ name: 'renamed', isStreamingEnabled: true, isContentstackAuthenticationEnabled: false }]);
    expect(stdout).toBe('✔ Environment updated successfully.\n');
    expect(onWire).toEqual([]);
  });

  it('refuses a password value on the command line with exit 2 before any request', async () => {
    const { error } = await runCommand(updateArgs('--password-protection', 'enable', '-p', 'on-argv'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming the updatable flags and sends nothing when none was supplied', async () => {
    const { error } = await runCommand(updateArgs(), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Pass at least one of --name,');
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming --yes, and never sends the PUT, when disabling cache priming without a terminal', async () => {
    const sent: unknown[] = [];
    reads();
    const put = update(sent);

    const { error } = await runCommand(updateArgs('--cache-priming', 'disable'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      'Are you sure you want to disable cache priming for this environment? ' +
        'Pass --yes to confirm without an interactive terminal.',
    );
    expect(put.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('enables password protection with a hidden password prompt, and never prints the password', async () => {
    const password = randomBytes(8).toString('hex');
    const sent: unknown[] = [];
    reads();
    const put = update(sent);
    const prompts = answerPrompts({ Password: password });

    const { error, stdout } = await onTerminal(() =>
      runCommand(updateArgs('--password-protection', 'enable', '-u', 'admin', '-p'), config),
    );

    expect(error).toBeUndefined();
    expect(put.isDone()).toBe(true);
    expect(prompts.payloads).toEqual([
      { type: 'password', name: 'value', message: 'Password', mask: '*', validate: expect.any(Function) },
    ]);
    expect(sent).toEqual([{ passwordProtection: { isEnabled: true, username: 'admin', password } }]);
    expect(stdout).not.toContain(password);
  });

  it('words the empty 409 the update endpoint sends for a taken name in the CLI its own words', async () => {
    reads();
    update([], 409, { errors: [{}], status: 409 });

    const { error } = await runCommand(updateArgs('--name', 'staging'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('An environment with that name already exists in this project.');
  });

  it('warns that --branch does not apply to a FileUpload project and sends the other fields without it', async () => {
    const sent: unknown[] = [];
    reads(uploadProjectFixture);
    const put = update(sent);

    const { error, stdout } = await runCommand(updateArgs('--branch', 'release', '--name', 'renamed'), config);

    expect(error).toBeUndefined();
    expect(stdout).toBe(
      'warn: --branch is not supported for FileUpload projects.\n\u2714 Environment updated successfully.\n',
    );
    expect(put.isDone()).toBe(true);
    expect(sent).toEqual([{ name: 'renamed' }]);
  });

  it('asks which settings to change on a terminal when no flag was given, and sends only the answers', async () => {
    const sent: unknown[] = [];
    reads();
    const put = update(sent);
    const prompts = answerPrompts({ 'Which settings do you want to change?': ['name'], Name: 'renamed' });

    const { error, stdout } = await onTerminal(() => runCommand(updateArgs(), config));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual(['Which settings do you want to change?', 'Name']);
    expect(prompts.payloads[0].type).toBe('checkbox');
    expect(put.isDone()).toBe(true);
    expect(sent).toEqual([{ name: 'renamed' }]);
    expect(stdout).toBe('\u2714 Environment updated successfully.\n');
  });

  it('says nothing changed, exits 0 and sends no PUT when every ticked setting keeps its value', async () => {
    reads();
    const put = update([]);
    answerPrompts({ 'Which settings do you want to change?': ['name'], Name: 'production' });

    const { error, stdout } = await onTerminal(() => runCommand(updateArgs(), config));

    expect(error).toBeUndefined();
    expect(stdout).toBe('Environment not updated. No changes were entered.\n');
    expect(put.isDone()).toBe(false);
  });
});
