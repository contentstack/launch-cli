import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { stdoutOfWidth } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const SECRETS_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/secrets`;
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

const LIST = ['launch:secrets:list', '--org', ORG_UID, '--project', PROJECT_UID, '--env', ENV_UID, '--data-dir', DATA_DIR];

let config: Interfaces.Config;
let unmatched: string[];

function recordUnmatched(): void {
  unmatched = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    unmatched.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

function secretsOfEnvironment() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0')
    .get(SECRETS_PATH);
}

describe('integration: launch:secrets:list driven through oclif runCommand', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    routeConsoleLogToStdout();
    recordUnmatched();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID).persist();
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.enableNetConnect();
    nock.restore();
  });

  it('reads the secrets endpoint under the right scope headers and prints KEY and UPDATED with no value', async () => {
    const restoreWidth = stdoutOfWidth(200);
    const value = randomUUID();

    try {
      const scope = secretsOfEnvironment().reply(200, {
        secrets: [{ key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z', value }],
        count: 1,
      });

      const { error, stdout } = await runCommand(LIST, config);

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(unmatched).toEqual([]);
      expect(stdout).toContain('│  KEY        │  UPDATED                   │');
      expect(stdout).toContain('│  API_TOKEN  │  2026-09-01T10:00:00.000Z  │');
      expect(stdout).not.toMatch(/VALUE/i);
      expect(stdout).not.toContain(value);
    } finally {
      restoreWidth();
    }
  });

  it('prints the empty placeholder and exits 0 for an environment with no secrets', async () => {
    const scope = secretsOfEnvironment().reply(200, { secrets: [], count: 0 });

    const { error, stdout } = await runCommand(LIST, config);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toContain('No records found.');
  });

  it('exits 1 with the permission message and none of the raw server text on a 403', async () => {
    const scope = secretsOfEnvironment().reply(403, {
      errors: [{ code: 'launch.AUTH.FORBIDDEN', message: 'raw-server-detail' }],
      status: 403,
    });

    const { error, stdout } = await runCommand(LIST, config);

    expect(scope.isDone()).toBe(true);
    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('You do not have permission to manage the secrets of this environment.');
    expect(error?.message).not.toContain('raw-server-detail');
    expect(stdout).not.toContain('raw-server-detail');
  });

  it('exits 2 naming --env when it is missing and there is no terminal to prompt on', async () => {
    const { error } = await runCommand(
      ['launch:secrets:list', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --env');
    expect(unmatched).toEqual([]);
  });
});
