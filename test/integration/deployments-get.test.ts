import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import getFixture from '../fixtures/deployment-get.json';
import notFoundFixture from '../fixtures/deployment-not-found.json';
import listFixture from '../fixtures/deployments-list.json';
import fileUploadProject from '../fixtures/project-get-fileupload.json';
import { stdoutOfWidth } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'e1f2a3b4c5d6e7f8091a2b3c';
const DEPLOYMENT_UID = 'd1e2f3a4b5c6d7e8f9012345';
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

const DEPLOYMENTS = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments`;

let config: Interfaces.Config;
let onWire: string[];

function recordWire(): void {
  onWire = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

function hub(): nock.Scope {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

function getArgs(...extra: string[]): string[] {
  return [
    'launch:deployments:get',
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

function valueOf(stdout: string, field: string): string | undefined {
  const row = stdout.split('\n').find((line) => line.startsWith(`│  ${field} `));

  return row?.split('│')[2].trim();
}

function ownedProject(): void {
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
}

describe('integration: launch:deployments:get on the wire', () => {
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

  it('shows the requested deployment with its status, branch, commit, url and an environment variable count', async () => {
    const restoreWidth = stdoutOfWidth(300);

    try {
      ownedProject();
      const scope = hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(200, getFixture);

      const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(valueOf(stdout, 'DEPLOYMENT UID')).toBe(DEPLOYMENT_UID);
      expect(valueOf(stdout, 'STATUS')).toBe('LIVE');
      expect(valueOf(stdout, 'BRANCH')).toBe('main');
      expect(valueOf(stdout, 'COMMIT')).toBe('9fceb02d0ae598e95dc970b74767f19372d61af8');
      expect(valueOf(stdout, 'COMMIT MESSAGE')).toBe('Ship the homepage');
      expect(valueOf(stdout, 'URL')).toBe('https://production-sample-project.contentstackapps.com');
      expect(valueOf(stdout, 'ENVIRONMENT VARIABLES')).toContain('2');
      expect(valueOf(stdout, 'BUILD LOGS')).toContain('csdx launch:logs:get');
      expect(stdout).not.toContain('KEY_ONE');
      expect(stdout).not.toContain('value-one');
      expect(onWire).toEqual([]);
    } finally {
      restoreWidth();
    }
  });

  it('asks for exactly one deployment when --deployment is absent and never reads the latest field', async () => {
    const restoreWidth = stdoutOfWidth(300);

    try {
      ownedProject();
      const latest = hub()
        .get(DEPLOYMENTS)
        .query({ limit: '1', skip: '0' })
        .reply(200, { ...listFixture, latest: 'ffffffffffffffffffffffff' });
      const other = hub().get(DEPLOYMENTS).query({ limit: '100', skip: '0' }).reply(200, listFixture);

      const { error, stdout } = await runCommand(getArgs(), config);

      expect(error).toBeUndefined();
      expect(latest.isDone()).toBe(true);
      expect(other.isDone()).toBe(false);
      expect(valueOf(stdout, 'DEPLOYMENT UID')).toBe(DEPLOYMENT_UID);
      expect(stdout).not.toContain('ffffffffffffffffffffffff');
    } finally {
      restoreWidth();
    }
  });

  it.each([[''], ['   ']])('treats --deployment %p as absent and looks up the latest', async (blank) => {
    ownedProject();
    const latest = hub().get(DEPLOYMENTS).query({ limit: '1', skip: '0' }).reply(200, listFixture);

    const { error } = await runCommand(getArgs('--deployment', blank === '' ? '""' : `"${blank}"`), config);

    expect(error).toBeUndefined();
    expect(latest.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming the empty environment when it has no deployment at all', async () => {
    ownedProject();
    hub().get(DEPLOYMENTS).query({ limit: '1', skip: '0' }).reply(200, { pagination: { count: 0 }, deployments: [] });

    const { error, stdout } = await runCommand(getArgs(), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No deployments found in this environment.');
    expect(stdout).toBe('');
  });

  it('leaves branch and commit rows out for a file-upload project', async () => {
    const restoreWidth = stdoutOfWidth(300);

    try {
      nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).times(2).reply(200, fileUploadProject);
      hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(200, getFixture);

      const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

      expect(error).toBeUndefined();
      expect(valueOf(stdout, 'DEPLOYMENT UID')).toBe(DEPLOYMENT_UID);
      expect(stdout).not.toContain('BRANCH');
      expect(stdout).not.toContain('COMMIT');
      expect(stdout).not.toContain('Ship the homepage');
      expect(stdout).not.toContain('9fceb02d');
    } finally {
      restoreWidth();
    }
  });

  it('exits 2 with generic wording when the deployment is not in this environment', async () => {
    ownedProject();
    hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(404, notFoundFixture);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No deployment with UID "${DEPLOYMENT_UID}" found in this environment.`);
    expect(error?.message).not.toContain(ENV_UID);
    expect(error?.message).not.toContain(PROJECT_UID);
    expect(stdout).toBe('');
  });

  it('exits 1 for a server failure rather than calling it a missing deployment', async () => {
    ownedProject();
    hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).times(5).reply(500, { errors: [{ code: 'launch.UNKNOWN', message: 'boom' }] });

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(1);
  });
});
