import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import listFixture from '../fixtures/environments-list.json';
import { projectOwnership } from '../support/project-ownership';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { stdoutOfWidth } from '../support/terminal';

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
let onWire: string[];

function secretsRead(status: number, body?: unknown) {
  return nock(LAUNCH_HUB_URL, { badheaders: ['content-type'] })
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0')
    .get(SECRETS_PATH)
    .reply(status, body as nock.Body);
}

describe('integration: launch:secrets:list on the wire', () => {
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
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID).persist();
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

  it('L5 reads GET .../secrets with the scope headers and no body, and prints only KEY and UPDATED', async () => {
    const restoreWidth = stdoutOfWidth(200);
    const leaked = randomUUID();

    try {
      const scope = secretsRead(200, {
        secrets: [
          { key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z', value: leaked },
          { key: 'DB_PASSWORD', updatedAt: '2026-09-02T11:30:00.000Z' },
        ],
        count: 2,
      });

      const { error, stdout } = await runCommand(LIST, config);

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(onWire).toEqual([]);
      expect(stdout).toContain('│  KEY          │  UPDATED                   │');
      expect(stdout).toContain('│  API_TOKEN    │  2026-09-01T10:00:00.000Z  │');
      expect(stdout).toContain('│  DB_PASSWORD  │  2026-09-02T11:30:00.000Z  │');
      expect(stdout).not.toContain('VALUE');
      expect(stdout).not.toContain(leaked);
    } finally {
      restoreWidth();
    }
  });

  it('L2 prints the empty-state line and exits 0 for an environment without secrets', async () => {
    const scope = secretsRead(200, { secrets: [], count: 0 });

    const { error, stdout } = await runCommand(LIST, config);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe('No secrets found in this environment.\n');
    expect(process.exitCode).toBe(0);
  });

  it('L3 resolves an environment name through the environment list and reads that uid', async () => {
    const scan = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments`)
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);
    const scope = secretsRead(200, { secrets: [], count: 0 });
    const args = [...LIST];
    args[args.indexOf('--env') + 1] = 'production';

    const { error } = await runCommand(args, config);

    expect(error).toBeUndefined();
    expect([scan.isDone(), scope.isDone()]).toEqual([true, true]);
    expect(onWire).toEqual([]);
  });

  it('L3 exits 2 naming the environment, and reads no secrets, when the name is not in the project', async () => {
    const scan = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments`)
      .query({ limit: '100', skip: '0' })
      .reply(200, { pagination: { count: 0, limit: 100, skip: 0 }, environments: [] });
    const scope = secretsRead(200, { secrets: [], count: 0 });
    const args = [...LIST];
    args[args.indexOf('--env') + 1] = 'staging';

    const { error, stdout } = await runCommand(args, config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No environment named "staging" found in this project.');
    expect(stdout).toBe('');
    expect([scan.isDone(), scope.isDone()]).toEqual([true, false]);
  });

  it('L3 exits 2 naming --env when it is missing and there is no terminal to prompt on', async () => {
    const scope = secretsRead(200, { secrets: [], count: 0 });

    const { error } = await runCommand(
      ['launch:secrets:list', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --env');
    expect(scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('L3 exits 2 naming --org when it is missing and there is no terminal to prompt on', async () => {
    const { error } = await runCommand(
      ['launch:secrets:list', '--project', PROJECT_UID, '--env', ENV_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --org');
    expect(onWire).toEqual([]);
  });

  it.each([
    [
      'a missing environment',
      404,
      { errors: [{ code: 'launch.ENVIRONMENT.NOT_FOUND', message: 'Environment not found.' }], status: 404 },
      'The project or environment was not found.',
    ],
    [
      'a 404 that names a secret key',
      404,
      { errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND', message: 'Key not found.' }] },
      'The project or environment was not found.',
    ],
    [
      'a policy refusal',
      403,
      { errors: [{ code: 'launch.RBAC.FORBIDDEN', message: 'raw forbidden text' }] },
      'You do not have permission to view the secrets of this environment.',
    ],
    [
      'a rejected request',
      400,
      { errors: [{ code: 'launch.ENVIRONMENT.BAD', message: 'raw bad request text' }] },
      'The Launch API rejected the request to list the secrets of this environment.',
    ],
  ])('L4 exits 1 with read-context wording and prints no table for %s', async (_label, status, body, message) => {
    const scope = secretsRead(status, body);

    const { error, stdout } = await runCommand(LIST, config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(message);
    expect(stdout).toBe('');
    expect(scope.isDone()).toBe(true);
  });
});
