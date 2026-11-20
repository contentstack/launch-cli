import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { answerPrompts, CTRL_C, pretendTerminal, stubPrompts } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

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
    config = await loadCliConfig();
  });

  beforeEach(() => {
    process.exitCode = 0;
    routeConsoleLogToStdout();
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

  it('refuses a --data-dir that does not exist, naming it, instead of reporting a missing --org, and sends nothing', async () => {
    useSession(basicSession());
    const missing = join(mkdtempSync(join(tmpdir(), 'launch-flow-')), 'no-such-folder');
    tempDirs.push(join(missing, '..'));
    const scope = nock(LAUNCH_HUB_URL).get(/.*/).reply(200, listFixture);

    const { error, stdout, stderr } = await runLaunch(['launch:projects:list', '--data-dir', missing]);

    expect(error?.oclif?.exit).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(
      `error: No folder found at '${missing}', so there is no ${PROJECT_CONFIG_FILE} to read. ` +
        'Pass --data-dir with a folder that exists.\n',
    );
    expect(scope.isDone()).toBe(false);
  });

  it('lets a missing --data-dir pass when the flags already supply everything the config file would', async () => {
    useSession(basicSession());
    const missing = join(mkdtempSync(join(tmpdir(), 'launch-flow-')), 'no-such-folder');
    tempDirs.push(join(missing, '..'));
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get('/manage/projects')
      .query(true)
      .reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:list', '--org', ORG_UID, '--data-dir', missing]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it.each([
    ['not valid JSON', '{ "project": ', 'is not valid JSON.'],
    ['an array', '[]', 'does not hold a project config.'],
  ])(
    'refuses a found %s config file, naming it, instead of reporting a missing --org',
    async (_kind, contents, reason) => {
      useSession(basicSession());
      const dir = mkdtempSync(join(tmpdir(), 'launch-flow-'));
      tempDirs.push(dir);
      const path = join(dir, PROJECT_CONFIG_FILE);
      writeFileSync(path, contents);
      const scope = nock(LAUNCH_HUB_URL).get(/.*/).reply(200, listFixture);

      const { error, stdout, stderr } = await runLaunch(['launch:projects:list', '--data-dir', dir]);

      expect(error?.oclif?.exit).toBe(2);
      expect(stdout).toBe('');
      expect(stderr).toBe(
        `error: The config file at '${path}' ${reason} Fix or delete it, or pass the missing flags.\n`,
      );
      expect(scope.isDone()).toBe(false);
    },
  );

  it('reads the organization and the project out of a project folder config with no flags but the data dir', async () => {
    useSession(basicSession());
    const { dir } = projectFolder({ project: { organizationUid: ORG_UID, uid: PROJECT_UID } });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .matchHeader('x-project-uid', PROJECT_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .times(2)
      .reply(200, getFixture);

    const { error, stdout, stderr } = await runLaunch(['launch:projects:get', '--data-dir', dir]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stderr).toBe(`Using the organization and project UIDs from ${join(dir, PROJECT_CONFIG_FILE)}.\n`);
    expect(stdout).toBe(
      [
        '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
        '\u2502  NAME            \u2502  TYPE         \u2502  PROJECT UID               \u2502  DESCRIPTION  \u2502',
        '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
        '\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502',
        '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
        '',
      ].join('\n'),
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
      .times(2)
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch(['launch:projects:get']);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toContain('\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502');
  });

  it('reads a config file at a path the --config flag names', async () => {
    useSession(basicSession());
    const { path } = projectFolder({ main: { organizationUid: ORG_UID, uid: PROJECT_UID } }, 'elsewhere.json');
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .times(2)
      .reply(200, getFixture);

    const { error, stdout } = await runLaunch(['launch:projects:get', '--config', path]);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toContain('\u2502  NAME            \u2502  TYPE         \u2502  PROJECT UID               \u2502  DESCRIPTION  \u2502');
  });

  it('prefers an org passed on argv over the one the project folder config holds', async () => {
    useSession(basicSession());
    const otherOrg = 'blt0000000000000001';
    const { dir } = projectFolder({ project: { organizationUid: ORG_UID, uid: PROJECT_UID } });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', otherOrg)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .times(2)
      .reply(200, { project: { ...getFixture.project, organizationUid: otherOrg } });

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
      .times(2)
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
    expect(stdout).toContain('\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502');
  });

  it('never sends an authtoken header on an OAUTH session', async () => {
    const accessToken = randomUUID();
    useSession({ authorisationType: 'OAUTH', oauthAccessToken: accessToken, authtoken: randomUUID(), region: REGION });
    const scope = nock(LAUNCH_HUB_URL)
      .matchHeader('authtoken', (value) => value === undefined)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .times(2)
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
      .times(2)
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
    expect(stdout).toContain('\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502');
  });

  it('offers the interactive project picker on a terminal and fetches whatever was chosen', async () => {
    useSession(basicSession());
    const restoreTTY = pretendTerminal();
    const inquired: unknown[] = [];
    stubPrompts((payload) => {
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
    expect(stdout).toContain('\u2502  sample-project  \u2502  GITPROVIDER  \u2502  a1b2c3d4e5f60718293a4b5c  \u2502  -            \u2502');
  });

  it('exits 3 when the picker comes back with nothing chosen', async () => {
    useSession(basicSession());
    const restoreTTY = pretendTerminal();
    stubPrompts(() => undefined);
    nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:get', '--org', ORG_UID, '--data-dir', tmpdir()]);

    restoreTTY();

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
  });

  it('exits 3 when Ctrl-C aborts the searchable project picker', async () => {
    useSession(basicSession());
    const restoreTTY = pretendTerminal();
    answerPrompts({ 'Choose a project': CTRL_C });
    nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    const { error } = await runLaunch(['launch:projects:get', '--org', ORG_UID, '--data-dir', tmpdir()]);
    await new Promise((done) => setImmediate(done));

    restoreTTY();

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
    expect(process.listenerCount('SIGINT')).toBe(0);
  });
});
