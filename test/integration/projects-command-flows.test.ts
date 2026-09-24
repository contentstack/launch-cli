import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { pretendTerminal } from '../support/terminal';

import getFixture from '../fixtures/project-get.json';
import listFixture from '../fixtures/projects-list.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const PROJECT_CONFIG_FILE = '.cs-launch.json';

const REGION = {
  name: 'integration',
  cma: 'https://cma.integration.test',
  cda: 'https://cda.integration.test',
  uiHost: 'https://app.integration.test',
  launchHubUrl: LAUNCH_HUB_URL,
};

const tempDirs: string[] = [];
let config: Interfaces.Config;

function projectFolder(contents: unknown, fileName = PROJECT_CONFIG_FILE): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'launch-flow-'));
  tempDirs.push(dir);
  const path = join(dir, fileName);
  writeFileSync(path, JSON.stringify(contents));
  return { dir, path };
}

function basicSession(): Record<string, unknown> {
  return { authorisationType: 'BASIC', authtoken: randomUUID(), region: REGION };
}

function useSession(values: Record<string, unknown>) {
  return jest.spyOn(configHandler, 'get').mockImplementation((key: string) => values[key]);
}

function runLaunch(args: string[]) {
  return runCommand(args, config);
}

describe('integration: end-to-end command flows', () => {
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
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.cleanAll();
    jest.restoreAllMocks();
    tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    tempDirs.length = 0;
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.restore();
  });

  it('reads the organization and the project out of a project folder config with no flags but the data dir', async () => {
    useSession(basicSession());
    const { dir } = projectFolder({ project: { organizationUid: ORG_UID, uid: PROJECT_UID } });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .matchHeader('x-project-uid', PROJECT_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch(['launch:projects:get', '--data-dir', dir]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe(
      ['uid   a1b2c3d4e5f60718293a4b5c', 'name  sample-project', 'type  GITPROVIDER', ''].join('\n'),
    );
  });

  it('reads the same project folder config from the working directory when not even a data dir is passed', async () => {
    useSession(basicSession());
    const { dir } = projectFolder({ project: { organizationUid: ORG_UID, uid: PROJECT_UID } });
    jest.spyOn(process, 'cwd').mockReturnValue(dir);
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch(['launch:projects:get']);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toContain('uid   a1b2c3d4e5f60718293a4b5c');
  });

  it('reads a config file at a path the --config flag names', async () => {
    useSession(basicSession());
    const { path } = projectFolder({ main: { organizationUid: ORG_UID, uid: PROJECT_UID } }, 'elsewhere.json');
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch(['launch:projects:get', '--config', path]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toContain('name  sample-project');
  });

  it('prefers an org passed on argv over the one the project folder config holds', async () => {
    useSession(basicSession());
    const otherOrg = 'blt0000000000000001';
    const { dir } = projectFolder({ project: { organizationUid: ORG_UID, uid: PROJECT_UID } });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', otherOrg)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error } = await runLaunch(['launch:projects:get', '--data-dir', dir, '--org', otherOrg]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('sends a bearer token on the wire for an OAUTH session', async () => {
    const accessToken = randomUUID();
    useSession({ authorisationType: 'OAUTH', oauthAccessToken: accessToken, region: REGION });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      PROJECT_UID,
      '--data-dir',
      tmpdir(),
    ]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toContain('uid   a1b2c3d4e5f60718293a4b5c');
  });

  it('never sends an authtoken header on an OAUTH session', async () => {
    const accessToken = randomUUID();
    useSession({ authorisationType: 'OAUTH', oauthAccessToken: accessToken, authtoken: randomUUID(), region: REGION });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('authtoken', (value) => value === undefined)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      PROJECT_UID,
      '--data-dir',
      tmpdir(),
    ]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('forces a refresh on a 401 and succeeds on the retry with the freshly issued bearer token', async () => {
    const staleToken = randomUUID();
    const freshToken = randomUUID();
    let accessToken = staleToken;
    jest
      .spyOn(configHandler, 'get')
      .mockImplementation((key: string) =>
        key === 'authorisationType'
          ? 'OAUTH'
          : key === 'oauthAccessToken'
            ? accessToken
            : key === 'region'
              ? REGION
              : undefined,
      );
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockImplementation(async (forced?: boolean) => {
      if (forced) {
        accessToken = freshToken;
      }
    });
    const stale = nock(LAUNCH_HUB_URL)
      .matchHeader('authorization', `Bearer ${staleToken}`)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(401, { errors: [{ code: 'launch.AUTH.EXPIRED', message: 'expired' }] });
    const fresh = nock(LAUNCH_HUB_URL)
      .matchHeader('authorization', `Bearer ${freshToken}`)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch([
      'launch:projects:get',
      '--org',
      ORG_UID,
      '--project',
      PROJECT_UID,
      '--data-dir',
      tmpdir(),
    ]);

    expect(error).toBeUndefined();
    expect(stale.isDone()).toBe(true);
    expect(fresh.isDone()).toBe(true);
    expect(expirySpy).toHaveBeenCalledWith(true);
    expect(stdout).toContain('uid   a1b2c3d4e5f60718293a4b5c');
  });

  it('offers the interactive project picker on a terminal and fetches whatever was chosen', async () => {
    useSession(basicSession());
    const restoreTTY = pretendTerminal();
    const inquired: unknown[] = [];
    jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
      inquired.push(payload);
      return PROJECT_UID as never;
    });
    const picker = nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);
    const fetch = nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);

    const { error, stdout } = await runLaunch(['launch:projects:get', '--org', ORG_UID, '--data-dir', tmpdir()]);

    restoreTTY();

    expect(error).toBeUndefined();
    expect(picker.isDone()).toBe(true);
    expect(fetch.isDone()).toBe(true);
    expect(inquired).toEqual([
      {
        type: 'search-list',
        name: 'project',
        message: 'Choose a project',
        choices: [
          { name: 'sample-project', value: PROJECT_UID },
          { name: 'marketing-site', value: 'b2c3d4e5f60718293a4b5c6d' },
          { name: 'docs-site', value: 'c3d4e5f60718293a4b5c6d7e' },
        ],
      },
    ]);
    expect(stdout).toContain('uid   a1b2c3d4e5f60718293a4b5c');
  });

  it('exits 3 when the picker comes back with nothing chosen', async () => {
    useSession(basicSession());
    const restoreTTY = pretendTerminal();
    jest.spyOn(cliux, 'inquire').mockResolvedValue(undefined as never);
    nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:get', '--org', ORG_UID, '--data-dir', tmpdir()]);

    restoreTTY();

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
  });
});
