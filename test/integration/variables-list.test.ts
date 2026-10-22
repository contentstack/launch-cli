import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import getFixture from '../fixtures/environment-get.json';
import notFoundFixture from '../fixtures/environment-not-found.json';
import { stdoutOfWidth } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

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

function environmentOfProject() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0')
    .get(`/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`)
    .reply(200, getFixture);
}

const LIST = ['launch:variables:list', '--org', ORG_UID, '--project', PROJECT_UID, '--env', ENV_UID, '--data-dir', DATA_DIR];

describe('integration: launch:variables:list driven through oclif runCommand', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
  });

  beforeEach(() => {
    process.exitCode = 0;
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID).persist();
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.cleanAll();
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.restore();
  });

  it('reads the variables from the environment endpoint and prints each key with its value masked', async () => {
    const restoreWidth = stdoutOfWidth(200);

    try {
      const scope = environmentOfProject();

      const { error, stdout } = await runCommand(LIST, config);

      expect(error).toBeUndefined();
      expect(scope.isDone()).toBe(true);
      expect(stdout).toContain('\u2502  key1  \u2502  \u2022\u2022\u2022\u2022\u2022\u2022  \u2502  2025-11-06T07:39:53.582Z  \u2502');
      expect(stdout).not.toContain('value1');
      expect(stdout.trimEnd().split('\n').pop()).toBe('Showing 1-1 of 1');
    } finally {
      restoreWidth();
    }
  });

  it('exits 1 with the CLI wording and no value when the environment does not exist', async () => {
    nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`)
      .reply(404, notFoundFixture);

    const { error, stdout } = await runCommand(LIST, config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No environment found with that name or UID.');
    expect(stdout).not.toContain('value1');
  });

  it('exits 2 naming --env when it is missing and there is no terminal to prompt on', async () => {
    const { error } = await runCommand(
      ['launch:variables:list', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --env');
  });

  it('rejects --limit 0 before any request is sent', async () => {
    const scope = environmentOfProject();

    const { error } = await runCommand([...LIST, '--limit', '0'], config);

    expect(error).toBeDefined();
    expect(scope.isDone()).toBe(false);
  });
});
