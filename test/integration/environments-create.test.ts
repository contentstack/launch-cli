import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import * as watcher from '../../src/deployments/deployment.watcher';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

import projectFixture from '../fixtures/project-get.json';

jest.mock('open', () => jest.fn().mockResolvedValue(undefined));

const realWatchTiming = watcher.defaultWatchTiming;

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const DEPLOYMENT_UID = 'f60718293a4b5c6d7e8f9012';
const ENV_PATH = `/manage/projects/${PROJECT_UID}/environments`;
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

const GITHUB_ARGS = [
  'launch:env:create',
  '--org',
  ORG_UID,
  '--project',
  PROJECT_UID,
  '--name',
  'production',
  '--branch',
  'main',
  '--framework',
  'Other',
  '--build-cmd',
  'eleventy',
  '--output-dir',
  './_site',
  '--res-mode',
  'buffered',
  '--data-dir',
  DATA_DIR,
];

let config: Interfaces.Config;
let onWire: string[];

function hub(): nock.Scope {
  return nock(LAUNCH_HUB_URL).matchHeader('x-organization-uid', ORG_UID).matchHeader('x-project-uid', PROJECT_UID);
}

function stubCreate(sent: unknown[]): void {
  hub().get(`/manage/projects/${PROJECT_UID}`).reply(200, projectFixture);
  nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .get('/manage/projects/framework')
    .query(true)
    .reply(200, { framework: 'OTHER', buildCommand: 'npx @11ty/eleventy', outputDirectory: './_site' });
  hub()
    .post(ENV_PATH, (body: unknown) => {
      sent.push(body);
      return true;
    })
    .reply(201, { environment: { uid: ENV_UID, name: 'production' } });
}

function stubFollowUp(status: string): void {
  hub()
    .get(`${ENV_PATH}/${ENV_UID}/deployments`)
    .query({ limit: 1, skip: 0 })
    .reply(200, { pagination: { count: 1, limit: 1, skip: null }, deployments: [{ uid: DEPLOYMENT_UID, status: 'QUEUED' }] });
  hub()
    .get(`${ENV_PATH}/${ENV_UID}/deployments/${DEPLOYMENT_UID}`)
    .reply(200, { deployment: { uid: DEPLOYMENT_UID, status, deploymentUrl: 'production.example.test' } });
  hub()
    .get(`/logs/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments/${DEPLOYMENT_UID}/logs/deployment-logs`)
    .query(true)
    .reply(200, { deploymentLogs: [] });
}

describe('integration: launch:env:create on the wire', () => {
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
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => ({
      ...realWatchTiming(),
      sleep: async () => undefined,
    }));
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

  it('creates a GitHub environment and follows its first deployment, without a terminal or a closing read', async () => {
    const sent: unknown[] = [];
    stubCreate(sent);
    stubFollowUp('LIVE');

    const { error, stdout } = await runCommand(GITHUB_ARGS, config);

    expect(error).toBeUndefined();
    expect(sent).toEqual([
      {
        name: 'production',
        gitBranch: 'main',
        buildCommand: 'eleventy',
        outputDirectory: './_site',
        frameworkPreset: 'OTHER',
        environmentVariables: [],
        isStreamingEnabled: false,
      },
    ]);
    expect(stdout).toContain('✔ Environment created successfully.');
    expect(stdout).toContain('production.example.test');
    expect(stdout).not.toContain('│');
    expect(onWire).toEqual([]);
  });

  it('exits 1 naming the surviving environment when the first deployment fails', async () => {
    stubCreate([]);
    stubFollowUp('FAILED');

    const { error, stdout } = await runCommand(GITHUB_ARGS, config);

    expect(error?.oclif?.exit).toBe(1);
    expect(stdout).toContain('✔ Environment created successfully.');
    expect(error?.message).toContain(
      `The environment "production" (${ENV_UID}) was created and has not been rolled back. ` +
        `Run csdx launch:deployments:create --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID}`,
    );
  });
});
