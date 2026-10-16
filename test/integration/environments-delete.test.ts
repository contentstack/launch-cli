import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { answerPrompts, onTerminal } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

import getFixture from '../fixtures/environment-get.json';
import listFixture from '../fixtures/environments-list.json';
import notFoundFixture from '../fixtures/environment-not-found.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const ENV_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`;
const DATA_DIR = tmpdir();
const BODYLESS = { badheaders: ['content-type'] };
const QUESTION = 'Are you sure you want to delete this environment?';

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

function deleteArgs(...extra: string[]): string[] {
  return ['launch:env:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR, ...extra];
}

function lookupAndRemoval(status = 200, body: unknown = getFixture) {
  const lookup = nock(LAUNCH_HUB_URL)
    .matchHeader('x-project-uid', PROJECT_UID)
    .get(ENV_PATH)
    .reply(status, body as nock.Body);
  const removal = nock(LAUNCH_HUB_URL, BODYLESS)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .delete(ENV_PATH)
    .reply(204);

  return { lookup, removal };
}

describe('integration: launch:env:delete on the wire', () => {
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

  it('deletes the environment with a bodyless DELETE and says so when --yes is given', async () => {
    const { lookup, removal } = lookupAndRemoval();

    const { error, stdout } = await runCommand(deleteArgs('--env', ENV_UID, '--yes'), config);

    expect(error).toBeUndefined();
    expect([lookup.isDone(), removal.isDone()]).toEqual([true, true]);
    expect(stdout).toBe('✔ Environment deleted successfully.\n');
    expect(onWire).toEqual([]);
  });

  it('resolves an environment name and deletes the uid it resolves to', async () => {
    const scan = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments`)
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);
    const { lookup, removal } = lookupAndRemoval();

    const { error } = await runCommand(deleteArgs('--env', 'production', '--yes'), config);

    expect(error).toBeUndefined();
    expect([scan.isDone(), lookup.isDone(), removal.isDone()]).toEqual([true, true, true]);
  });

  it('exits 2 naming --yes, and never sends the delete, without a terminal and without --yes', async () => {
    const { lookup, removal } = lookupAndRemoval();

    const { error } = await runCommand(deleteArgs('--env', ENV_UID), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${QUESTION} Pass --yes to confirm without an interactive terminal.`);
    expect([lookup.isDone(), removal.isDone()]).toEqual([true, false]);
    expect(onWire).toEqual([]);
  });

  it('says the environment was not deleted, exits 3 and never sends the delete when the user declines', async () => {
    const { lookup, removal } = lookupAndRemoval();
    const prompts = answerPrompts({ [QUESTION]: false });

    const { error, stdout } = await onTerminal(() => runCommand(deleteArgs('--env', ENV_UID), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(stdout).toBe('Environment not deleted.\n');
    expect(prompts.messages).toEqual([QUESTION]);
    expect([lookup.isDone(), removal.isDone()]).toEqual([true, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 1 before asking anything when the environment does not exist', async () => {
    const { lookup, removal } = lookupAndRemoval(404, notFoundFixture);
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(deleteArgs('--env', ENV_UID), config));

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No environment found with that name or UID.');
    expect(prompts.messages).toEqual([]);
    expect([lookup.isDone(), removal.isDone()]).toEqual([true, false]);
  });
});
