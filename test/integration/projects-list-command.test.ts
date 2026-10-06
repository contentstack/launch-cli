import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { Config, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import getFixture from '../fixtures/project-get.json';
import listFixture from '../fixtures/projects-list.json';
import notFoundFixture from '../fixtures/project-not-found.json';
import { stdoutOfWidth } from '../support/terminal';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const AUTHTOKEN = 'test-authtoken';
const DATA_DIR = tmpdir();

const CONFIG: Record<string, unknown> = {
  authorisationType: 'BASIC',
  authtoken: AUTHTOKEN,
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

function runLaunch(args: string[]) {
  return runCommand(args, config);
}

describe('integration: shipped commands driven through oclif runCommand', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
  });

  beforeEach(() => {
    process.exitCode = 0;
    jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
      process.stdout.write(`${String(message)}\n`);
    });
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.cleanAll();
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.restore();
  });

  it('prints the project table and the pagination line for launch:projects:list', async () => {
    const restoreWidth = stdoutOfWidth(200);

    try {
      const scope = nock(LAUNCH_HUB_URL)
        .get('/manage/projects')
        .query({ limit: '100', skip: '0' })
        .reply(200, listFixture);

      const { error, stdout } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--data-dir', DATA_DIR]);

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(stdout).toBe(
        [
          '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
          '\u2502  NAME            \u2502  TYPE         \u2502  UID                       \u2502',
          '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
          '\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502',
          '\u251c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u253c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u253c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2524',
          '\u2502  marketing-site  \u2502  GITPROVIDER  \u2502  b2c3d4e5f60718293a4b5c6d  \u2502',
          '\u251c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u253c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u253c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2524',
          '\u2502  docs-site       \u2502  FILEUPLOAD   \u2502  c3d4e5f60718293a4b5c6d7e  \u2502',
          '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
          'Showing 1-3 of 3',
          '',
        ].join('\n'),
      );

    } finally {
      restoreWidth();
    }
  });

  it('sends the limit and skip supplied on argv for launch:projects:list', async () => {
    const scope = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '2', skip: '1' })
      .reply(200, listFixture);

    const { error } = await runLaunch([
      'launch:projects:list',
      '--org',
      ORG_UID,
      '--limit',
      '2',
      '--skip',
      '1',
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('prints the detail block for launch:projects:get', async () => {
    const scope = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);

    const { error, stdout } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      PROJECT_UID,
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe(
      [
        '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
        '\u2502  NAME            \u2502  TYPE         \u2502  UID                       \u2502  DESCRIPTION  \u2502',
        '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
        '\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502',
        '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
        '',
      ].join('\n'),
    );
  });

  it('resolves a project name to a uid before fetching it', async () => {
    const lookup = nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);
    const fetch = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);

    const { error, stdout } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      'sample-project',
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error).toBeUndefined();
    expect(lookup.isDone()).toBe(true);
    expect(fetch.isDone()).toBe(true);
    expect(stdout).toContain('\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502');
  });

  it('refuses --limit 0 with exit 2 before any request, because the API reads a zero limit as no limit at all', async () => {
    const scope = nock(LAUNCH_HUB_URL).get('/manage/projects').query(true).reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--limit', '0', '--data-dir', DATA_DIR]);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--limit');
    expect(scope.isDone()).toBe(false);
  });

  it('sends --limit 1, the smallest page it accepts', async () => {
    const scope = nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '1', skip: '0' }).reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--limit', '1', '--data-dir', DATA_DIR]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('ignores a conflicting multi-branch config file when the flags already supply every value, and reports it only when one is needed', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'launch-conflict-'));
    writeFileSync(
      join(folder, '.cs-launch.json'),
      JSON.stringify({ main: { uid: 'a'.repeat(24), organizationUid: ORG_UID }, dev: { uid: 'b'.repeat(24), organizationUid: ORG_UID } }),
    );
    const scope = nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    try {
      const withFlags = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--data-dir', folder]);
      const needingConfig = await runLaunch(['launch:projects:get', '--org', ORG_UID, '--data-dir', folder]);

      expect(withFlags.error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(needingConfig.error?.oclif?.exit).toBe(2);
      expect(needingConfig.error?.message).toContain('main');
      expect(needingConfig.error?.message).toContain('dev');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('reports a bad flag as a usage error, exit 2, even when the user is logged out', async () => {
    jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(false);

    const { error } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--no-such-flag', '--data-dir', DATA_DIR]);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--no-such-flag');
  });

  it('still refuses a logged-out user with exit 1 once the flags parse', async () => {
    jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(false);
    const scope = nock(LAUNCH_HUB_URL).get('/manage/projects').query(true).reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--data-dir', DATA_DIR]);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('You are not logged in. Run csdx auth:login to continue.');
    expect(scope.isDone()).toBe(false);
  });

  it('exits 2 when a required input is missing and there is no terminal to prompt on', async () => {
    const { error } = await runLaunch(['launch:projects:list', '--data-dir', DATA_DIR]);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --org');
  });

  it('exits 2 when a project name cannot be resolved in the organization', async () => {
    nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    const { error } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      'ghost-site',
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No project named "ghost-site" found in this organization.');
  });

  it('exits 1 with the mapped message when the API answers 404', async () => {
    nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(404, notFoundFixture);

    const { error } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      PROJECT_UID,
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No project found with that name or UID.');
  });

  it('exits 1 when the session is not authenticated', async () => {
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => (key === 'region' ? CONFIG.region : undefined));

    const { error } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--data-dir', DATA_DIR]);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('You are not logged in.');
  });
});
