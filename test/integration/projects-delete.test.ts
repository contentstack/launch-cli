import { tmpdir } from 'node:os';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { CTRL_C, answerPrompts, onTerminal, pretendTerminal } from '../support/terminal';

import getFixture from '../fixtures/project-get.json';
import listFixture from '../fixtures/projects-list.json';
import notFoundFixture from '../fixtures/project-not-found.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const DATA_DIR = tmpdir();
const BODYLESS = { badheaders: ['content-type'] };

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

function recordWire(): void {
  onWire = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

describe('integration: launch:projects:delete on the wire', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    recordWire();
    jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
      process.stdout.write(`${String(message)}\n`);
    });
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

  it('deletes the project and reports it by name when --yes was passed', async () => {
    const lookup = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const removal = nock(LAUNCH_HUB_URL, BODYLESS).delete(`/manage/projects/${PROJECT_UID}`).query({}).reply(204);

    const { error, stdout } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--yes', '--data-dir', DATA_DIR],
      config,
    );

    expect(error).toBeUndefined();
    expect(lookup.isDone()).toBe(true);
    expect(removal.isDone()).toBe(true);
    expect(stdout).toBe('✔ Project "sample-project" deleted.\n');
    expect(onWire).toEqual([]);
  });

  it('accepts a project name and deletes the uid it resolves to', async () => {
    const lookup = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);
    const fetch = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const removal = nock(LAUNCH_HUB_URL, BODYLESS).delete(`/manage/projects/${PROJECT_UID}`).query({}).reply(204);

    const { error, stdout } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', 'sample-project', '--yes', '--data-dir', DATA_DIR],
      config,
    );

    expect(error).toBeUndefined();
    expect(lookup.isDone()).toBe(true);
    expect(fetch.isDone()).toBe(true);
    expect(removal.isDone()).toBe(true);
    expect(stdout).toBe('✔ Project "sample-project" deleted.\n');
  });

  it('exits 2 naming the project and --yes, and never sends the delete, without a terminal and without --yes', async () => {
    const lookup = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const removal = nock(LAUNCH_HUB_URL, BODYLESS).delete(`/manage/projects/${PROJECT_UID}`).query({}).reply(204);

    const { error } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      `Delete project "sample-project" (${PROJECT_UID})? This cannot be undone. ` +
        'Pass --yes to confirm without an interactive terminal.',
    );
    expect(onWire).toEqual([]);
    expect(lookup.isDone()).toBe(true);
    expect(removal.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual([`DELETE ${LAUNCH_HUB_URL}:443/manage/projects/${PROJECT_UID}`]);
  });

  it('resolves a project name and names it in the refusal, and never sends the delete, without --yes', async () => {
    const scan = nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);
    const lookup = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const removal = nock(LAUNCH_HUB_URL, BODYLESS).delete(`/manage/projects/${PROJECT_UID}`).query({}).reply(204);

    const { error } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', 'sample-project', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      `Delete project "sample-project" (${PROJECT_UID})? This cannot be undone. ` +
        'Pass --yes to confirm without an interactive terminal.',
    );
    expect(onWire).toEqual([]);
    expect([scan.isDone(), lookup.isDone(), removal.isDone()]).toEqual([true, true, false]);
  });

  it('exits 3 and never sends the delete when the user declines the prompt', async () => {
    const lookup = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const removal = nock(LAUNCH_HUB_URL, BODYLESS).delete(`/manage/projects/${PROJECT_UID}`).query({}).reply(204);
    const restore = pretendTerminal();
    const inquired: unknown[] = [];
    jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
      inquired.push(payload);
      return false as never;
    });

    try {
      const { error } = await runCommand(
        ['launch:projects:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
        config,
      );

      expect(error?.oclif?.exit).toBe(3);
      expect(error?.message).toBe('Cancelled. Nothing was changed.');
      expect(inquired).toEqual([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete project "sample-project" (${PROJECT_UID})? This cannot be undone.`,
          default: false,
        },
      ]);
      expect(onWire).toEqual([]);
      expect(lookup.isDone()).toBe(true);
      expect(removal.isDone()).toBe(false);
      expect(nock.pendingMocks()).toEqual([`DELETE ${LAUNCH_HUB_URL}:443/manage/projects/${PROJECT_UID}`]);
    } finally {
      restore();
    }
  });

  it('exits 3 as cancelled, not 130, and never sends the delete when Ctrl-C is pressed at the confirmation', async () => {
    const lookup = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const removal = nock(LAUNCH_HUB_URL, BODYLESS).delete(`/manage/projects/${PROJECT_UID}`).query({}).reply(204);
    const question = `Delete project "sample-project" (${PROJECT_UID})? This cannot be undone.`;
    const prompts = answerPrompts({ [question]: CTRL_C });

    const { error } = await onTerminal(() =>
      runCommand(['launch:projects:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR], config),
    );

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
    expect(prompts.messages).toEqual([question]);
    expect(lookup.isDone()).toBe(true);
    expect(removal.isDone()).toBe(false);
    expect(onWire).toEqual([]);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('exits 2 naming a project that does not exist in the organization', async () => {
    nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    const { error } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', 'ghost-site', '--yes', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No project named "ghost-site" found in this organization.');
  });

  it('exits 1 when the API refuses the delete for want of permission', async () => {
    nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    nock(LAUNCH_HUB_URL, BODYLESS)
      .delete(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(403, { errors: [{ code: 'launch.FORBIDDEN', message: 'Forbidden Resource' }] });

    const { error } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--yes', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('Forbidden Resource');
  });

  it('exits 1 with the project wording when the uid is unknown to the API', async () => {
    nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(404, notFoundFixture);

    const { error } = await runCommand(
      ['launch:projects:delete', '--org', ORG_UID, '--project', PROJECT_UID, '--yes', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No project found with that name or UID.');
  });
});
