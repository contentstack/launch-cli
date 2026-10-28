import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import listFixture from '../fixtures/deployments-list.json';
import environmentsFixture from '../fixtures/environments-list.json';
import fileUploadProject from '../fixtures/project-get-fileupload.json';
import { stdoutOfWidth } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'e1f2a3b4c5d6e7f8091a2b3c';
const PRODUCTION_ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
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

function recordWire(): void {
  onWire = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

function hub(environment: string = ENV_UID): nock.Interceptor {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0')
    .get(`/manage/projects/${PROJECT_UID}/environments/${environment}/deployments`);
}

function listArgs(...extra: string[]): string[] {
  return [
    'launch:deployments:list',
    '--org',
    ORG_UID,
    '--project',
    PROJECT_UID,
    '--env',
    ENV_UID,
    ...extra,
    '--data-dir',
    DATA_DIR,
  ];
}

describe('integration: launch:deployments:list on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    recordWire();
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

  it('lists a git project piped with DEPLOYMENT UID, no bare UID header, and a footer from the command skip', async () => {
    const restoreWidth = stdoutOfWidth(200);

    try {
      projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
      projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
      const scope = hub().query({ limit: '100', skip: '0' }).reply(200, listFixture);

      const { error, stdout } = await runCommand(listArgs(), config);
      const header = stdout.split('\n').find((line) => line.includes('DEPLOYMENT UID')) ?? '';

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(header).toContain('STATUS');
      expect(header.replace('DEPLOYMENT UID', '')).not.toMatch(/\bUID\b/);
      expect(stdout).toContain('d1e2f3a4b5c6d7e8f9012345');
      expect(stdout).toContain('LIVE');
      expect(stdout).toContain('FAILED');
      expect(stdout).toContain('9fceb02');
      expect(stdout).toContain('develop');
      expect(stdout.trimEnd().split('\n').pop()).toBe('Showing 1-2 of 2');
      expect(onWire).toEqual([]);
    } finally {
      restoreWidth();
    }
  });

  it('leaves branch and commit out of the list of a file-upload project', async () => {
    const restoreWidth = stdoutOfWidth(200);

    try {
      nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).times(2).reply(200, fileUploadProject);
      hub().query(true).reply(200, listFixture);

      const { error, stdout } = await runCommand(listArgs(), config);

      expect(error).toBeUndefined();
      expect(stdout).toContain('DEPLOYMENT UID');
      expect(stdout).not.toContain('BRANCH');
      expect(stdout).not.toContain('COMMIT');
      expect(stdout).not.toContain('develop');
      expect(stdout).not.toContain('9fceb02');
    } finally {
      restoreWidth();
    }
  });

  it.each([['1'], ['1000']])('sends --limit %s as the limit query', async (limit) => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const scope = hub().query({ limit, skip: '0' }).reply(200, listFixture);

    const { error } = await runCommand(listArgs('--limit', limit), config);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('sends --skip as the skip query', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const scope = hub().query({ limit: '100', skip: '10' }).reply(200, listFixture);

    const { error } = await runCommand(listArgs('--skip', '10'), config);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it.each([
    [['--limit', '0']],
    [['--limit', '1001']],
    [['--skip', '-1']],
  ])('exits 2 for %p and sends nothing', async (extra) => {
    const scope = hub().query(true).reply(200, listFixture);

    const { error } = await runCommand(listArgs(...extra), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('resolves --env by name through the environments list and shows no picker', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const names = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .matchHeader('x-project-uid', PROJECT_UID)
      .get(`/manage/projects/${PROJECT_UID}/environments`)
      .query({ limit: '100', skip: '0' })
      .reply(200, environmentsFixture);
    const scope = hub(PRODUCTION_ENV_UID).query({ limit: '100', skip: '0' }).reply(200, listFixture);
    const args = listArgs();
    args[args.indexOf(ENV_UID)] = 'production';

    const { error } = await runCommand(args, config);

    expect(error).toBeUndefined();
    expect(names.isDone()).toBe(true);
    expect(scope.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });
});
