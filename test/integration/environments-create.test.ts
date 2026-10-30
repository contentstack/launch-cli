import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import * as watcher from '../../src/deployments/deployment.watcher';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';
import { answerPrompts, onTerminal } from '../support/terminal';

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
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
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

  describe('picking variable sources at the prompt', () => {
    const STACK_TOKEN = randomBytes(16).toString('hex');
    const WITH_AUTH = [...GITHUB_ARGS, '--cs-auth', 'enable', '--server-cmd', 'serve'];

    function stubStackPickers(): nock.Scope[] {
      const cma = nock('https://cma.integration.test');

      return [
        cma
          .get('/v3/stacks')
          .matchHeader('organization_uid', ORG_UID)
          .query({ limit: '100', skip: '0', query: JSON.stringify({ org_uid: ORG_UID }) })
          .reply(200, { stacks: [{ name: 'Shop', api_key: 'blt9stackkey' }] }),
        cma
          .get('/v3/stacks')
          .matchHeader('organization_uid', ORG_UID)
          .query({ limit: '100', skip: '1', query: JSON.stringify({ org_uid: ORG_UID }) })
          .reply(200, { stacks: [] }),
        cma
          .get('/v3/stacks/delivery_tokens')
          .query({ limit: '100', skip: '0' })
          .matchHeader('api_key', 'blt9stackkey')
          .reply(200, {
            tokens: [{ name: 'prod-token', token: STACK_TOKEN, scope: [{ environments: [{ name: 'staging' }] }] }],
          }),
        cma
          .get('/v3/stacks/delivery_tokens')
          .query({ limit: '100', skip: '1' })
          .matchHeader('api_key', 'blt9stackkey')
          .reply(200, { tokens: [] }),
        nock(LAUNCH_HUB_URL)
          .matchHeader('x-organization-uid', ORG_UID)
          .get('/manage/cms/environment-variables')
          .reply(200, [
            { keyName: 'CONTENTSTACK_API_HOST', key: 'CONTENTSTACK_API_HOST', value: 'api.integration.test' },
            { keyName: 'CONTENTSTACK_API_KEY', key: 'CONTENTSTACK_API_KEY' },
          ]),
      ];
    }

    it('merges a dotenv file and typed pairs in that order, the typed pair winning', async () => {
      const file = join(DATA_DIR, `env-create-${randomBytes(4).toString('hex')}.env`);
      writeFileSync(file, 'API_URL=from-file\nFROM_FILE=1\n');
      const prompts = answerPrompts({
        'Add environment variables': ['Import variables from a dotenv file', 'Manually add custom variables'],
        'Path to the dotenv file': file,
        'Enter variables separated by spaces (Ex: KEY1=value1 KEY2:value2 KEY3="value with spaces")': 'API_URL=typed DEBUG=true',
      });
      const sent: { environmentVariables?: unknown }[] = [];
      stubCreate(sent);
      stubFollowUp('LIVE');

      const { error, stdout } = await onTerminal(() => runCommand(WITH_AUTH, config));

      expect(error).toBeUndefined();
      expect(prompts.messages).toEqual([
        'Add environment variables',
        'Path to the dotenv file',
        'Enter variables separated by spaces (Ex: KEY1=value1 KEY2:value2 KEY3="value with spaces")',
      ]);
      expect(sent[0].environmentVariables).toEqual([
        { key: 'API_URL', value: 'typed' },
        { key: 'FROM_FILE', value: '1' },
        { key: 'DEBUG', value: 'true' },
      ]);
      expect(stdout).toContain('3 variables ready to set');
      expect(stdout).not.toContain('from-file');
      expect(onWire).toEqual([]);
    });

    it('merges all three sources, stack first, then the file, then the typed pairs, without printing the token', async () => {
      const file = join(DATA_DIR, `env-create-${randomBytes(4).toString('hex')}.env`);
      writeFileSync(file, 'CONTENTSTACK_ENVIRONMENT=from-file\nFROM_FILE=1\n');
      const prompts = answerPrompts({
        'Add environment variables': [
          'Import variables from a stack',
          'Import variables from a dotenv file',
          'Manually add custom variables',
        ],
        Stack: '0',
        'Delivery token': '0',
        'Path to the dotenv file': file,
        'Enter variables separated by spaces (Ex: KEY1=value1 KEY2:value2 KEY3="value with spaces")': 'FROM_FILE=typed EXTRA=1',
      });
      const sent: { environmentVariables?: unknown }[] = [];
      stubCreate(sent);
      const lookups = stubStackPickers();
      stubFollowUp('LIVE');

      const { error, stdout } = await onTerminal(() => runCommand(WITH_AUTH, config));

      expect(error).toBeUndefined();
      expect(prompts.messages).toEqual([
        'Add environment variables',
        'Stack',
        'Delivery token',
        'Path to the dotenv file',
        'Enter variables separated by spaces (Ex: KEY1=value1 KEY2:value2 KEY3="value with spaces")',
      ]);
      expect(lookups.every((scope) => scope.isDone())).toBe(true);
      expect(sent[0].environmentVariables).toEqual([
        { key: 'CONTENTSTACK_API_HOST', value: 'api.integration.test' },
        { key: 'CONTENTSTACK_API_KEY', value: 'blt9stackkey' },
        { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: STACK_TOKEN },
        { key: 'CONTENTSTACK_ENVIRONMENT', value: 'from-file' },
        { key: 'FROM_FILE', value: 'typed' },
        { key: 'EXTRA', value: '1' },
      ]);
      expect(stdout).toContain('6 variables ready to set');
      expect(stdout).not.toContain(STACK_TOKEN);
      expect(onWire).toEqual([]);
    });

    it('creates with no variables when Skip is chosen', async () => {
      answerPrompts({ 'Add environment variables': ['Skip adding environment variables'] });
      const sent: { environmentVariables?: unknown }[] = [];
      stubCreate(sent);
      stubFollowUp('LIVE');

      const { error } = await onTerminal(() => runCommand(WITH_AUTH, config));

      expect(error).toBeUndefined();
      expect(sent[0].environmentVariables).toEqual([]);
    });

    it('creates with no variables and asks nothing when --no-vars is given on a terminal', async () => {
      const prompts = answerPrompts({});
      const sent: { environmentVariables?: unknown }[] = [];
      stubCreate(sent);
      stubFollowUp('LIVE');

      const { error } = await onTerminal(() => runCommand([...WITH_AUTH, '--no-vars'], config));

      expect(error).toBeUndefined();
      expect(prompts.messages).toEqual([]);
      expect(sent[0].environmentVariables).toEqual([]);
    });

    it('refuses Skip combined with another source before creating anything', async () => {
      answerPrompts({ 'Add environment variables': ['Skip adding environment variables', 'Manually add custom variables'] });
      const sent: unknown[] = [];
      stubCreate(sent);

      const { error } = await onTerminal(() => runCommand(WITH_AUTH, config));

      expect(error?.message).toContain("'Skip adding environment variables' cannot be combined with the other options.");
      expect(sent).toEqual([]);
    });
  });

  it('exits 1 naming the surviving environment when the first deployment fails', async () => {
    stubCreate([]);
    stubFollowUp('FAILED');

    const { error, stdout } = await runCommand(GITHUB_ARGS, config);

    expect(error?.oclif?.exit).toBe(1);
    expect(stdout).toContain('✔ Environment created successfully.');
    expect(error?.message).toContain(
      `The environment "production" (${ENV_UID}) was created. ` +
        `Run csdx launch:logs:get --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID}`,
    );
  });
});
