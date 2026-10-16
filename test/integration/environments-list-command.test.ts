import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import getFixture from '../fixtures/environment-get.json';
import listFixture from '../fixtures/environments-list.json';
import notFoundFixture from '../fixtures/environment-not-found.json';
import projectsFixture from '../fixtures/projects-list.json';
import { stdoutOfWidth } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
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

function environmentsOfProject() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0')
    .get(`/manage/projects/${PROJECT_UID}/environments`)
    .query({ limit: '100', skip: '0' })
    .reply(200, listFixture);
}

function valueOf(stdout: string, field: string): string | undefined {
  const row = stdout.split('\n').find((line) => line.startsWith(`\u2502  ${field} `));

  return row?.split('\u2502')[2].trim();
}

describe('integration: launch:env commands driven through oclif runCommand', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
  });

  beforeEach(() => {
    process.exitCode = 0;
    routeConsoleLogToStdout();
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

  it('lists the environments of the project scoped by organization and project headers', async () => {
    const restoreWidth = stdoutOfWidth(200);

    try {
      const scope = environmentsOfProject();

      const { error, stdout } = await runCommand(
        ['launch:env:list', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
        config,
      );

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(stdout).toContain(
        '│  production  │  main     │  https://production-sample-project.contentstackapps.com  │' +
          '  2025-11-06T07:39:53.582Z  │  d4e5f60718293a4b5c6d7e8f  │',
      );
      expect(stdout).toContain('│  staging     │  develop  │');
      expect(stdout.trimEnd().split('\n').pop()).toBe('Showing 1-2 of 2');
    } finally {
      restoreWidth();
    }
  });

  it('resolves a project name to its uid before listing its environments', async () => {
    const lookup = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '100', skip: '0' })
      .reply(200, projectsFixture);
    const scope = environmentsOfProject();

    const { error } = await runCommand(
      ['launch:env:list', '--org', ORG_UID, '--project', 'sample-project', '--data-dir', DATA_DIR],
      config,
    );

    expect(error).toBeUndefined();
    expect(lookup.isDone()).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it('exits 2 naming --project when it is missing and there is no terminal to prompt on', async () => {
    const { error } = await runCommand(['launch:env:list', '--org', ORG_UID, '--data-dir', DATA_DIR], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --project');
  });

  it('resolves --env by name, fetches it and prints its fields with only a count of its variables', async () => {
    const restoreWidth = stdoutOfWidth(200);

    try {
      const scan = environmentsOfProject();
      const fetch = nock(LAUNCH_HUB_URL)
        .matchHeader('x-organization-uid', ORG_UID)
        .matchHeader('x-project-uid', PROJECT_UID)
        .get(`/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`)
        .reply(200, getFixture);

      const { error, stdout } = await runCommand(
        ['launch:env:get', '--org', ORG_UID, '--project', PROJECT_UID, '--env', 'production', '--data-dir', DATA_DIR],
        config,
      );

      expect(error).toBeUndefined();
      expect(scan.isDone()).toBe(true);
      expect(fetch.isDone()).toBe(true);
      expect(valueOf(stdout, 'NAME')).toBe('production');
      expect(valueOf(stdout, 'CONTENTSTACK AUTHENTICATION')).toBe('enabled');
      expect(valueOf(stdout, 'VARIABLES')).toBe('1');
      expect(valueOf(stdout, 'ORGANIZATION')).toBe(ORG_UID);
      expect(valueOf(stdout, 'PROJECT')).toBe(PROJECT_UID);
      expect(valueOf(stdout, 'CREATED AT')).toBe('2025-11-06T07:39:19.230Z');
      expect(stdout).not.toContain('value1');
      expect(stdout).not.toContain('key1');
    } finally {
      restoreWidth();
    }
  });

  it('exits 1 with the CLI wording when the environment does not exist', async () => {
    nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`)
      .reply(404, notFoundFixture);

    const { error } = await runCommand(
      ['launch:env:get', '--org', ORG_UID, '--project', PROJECT_UID, '--env', ENV_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No environment found with that name or UID.');
  });

  it('exits 2 when no environment of the project carries the --env name, sending no environment GET', async () => {
    const scan = environmentsOfProject();
    const fetch = nock(LAUNCH_HUB_URL).get(new RegExp(`/environments/[0-9a-f]{24}$`)).reply(200, getFixture);

    const { error } = await runCommand(
      ['launch:env:get', '--org', ORG_UID, '--project', PROJECT_UID, '--env', 'Production', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No environment named "Production" found in this project.');
    expect(scan.isDone()).toBe(true);
    expect(fetch.isDone()).toBe(false);
  });

  it('exits 2 naming --env when it is missing and there is no terminal to prompt on', async () => {
    const { error } = await runCommand(
      ['launch:env:get', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --env');
  });
});
