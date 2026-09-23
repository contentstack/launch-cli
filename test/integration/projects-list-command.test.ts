import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import getFixture from '../fixtures/project-get.json';
import listFixture from '../fixtures/projects-list.json';
import notFoundFixture from '../fixtures/project-not-found.json';

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
    const scope = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '50', skip: '0' })
      .reply(200, listFixture);

    const { error, stdout } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--data-dir', DATA_DIR]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe(
      [
        'UID                       NAME            TYPE         UPDATED',
        'a1b2c3d4e5f60718293a4b5c  sample-project  GITPROVIDER  2025-10-09T09:36:16.484Z',
        'b2c3d4e5f60718293a4b5c6d  marketing-site  GITPROVIDER  2025-08-28T10:27:31.065Z',
        'c3d4e5f60718293a4b5c6d7e  docs-site       FILEUPLOAD   2025-08-08T06:23:58.338Z',
        'Showing 1-3 of 3',
        '',
      ].join('\n'),
    );
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
      ['uid   a1b2c3d4e5f60718293a4b5c', 'name  sample-project', 'type  GITPROVIDER', ''].join('\n'),
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
    expect(stdout).toContain('uid   a1b2c3d4e5f60718293a4b5c');
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
