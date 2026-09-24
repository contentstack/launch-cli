import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const UPLOAD_HOST = 'https://uploads.integration.test';
const ORG_UID = `blt${randomBytes(8).toString('hex')}`;
const PROJECT_UID = randomBytes(12).toString('hex');
const ENVIRONMENT_UID = randomBytes(12).toString('hex');
const DEPLOYMENT_UID = randomBytes(12).toString('hex');

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

const CREATED_PROJECT = { uid: PROJECT_UID, name: 'My Site', projectType: 'GITPROVIDER' };

let config: Interfaces.Config;
let onWire: string[];
let dataDir: string;

function recordWire(): void {
  onWire = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

function gitFlags(): string[] {
  return [
    'launch:projects:create',
    '--org',
    ORG_UID,
    '--type',
    'GitHub',
    '--name',
    '"My Site"',
    '--env-name',
    'Default',
    '--namespace',
    'my-org',
    '--repo',
    'my-org/my-repo',
    '--branch',
    'main',
    '--framework',
    'NextJs',
    '--build-cmd',
    '"npm run build"',
    '--output-dir',
    '.next',
    '--res-mode',
    'buffered',
    '--data-dir',
    dataDir,
  ];
}

function stubGitLookups(): void {
  nock(LAUNCH_HUB_URL)
    .get('/manage/git-repositories')
    .query({ provider: 'GitHub', namespace: 'my-org', search: 'my-org/my-repo', limit: 100, skip: 0 })
    .reply(200, {
      pagination: { count: 1, limit: 100, skip: null },
      repositories: [
        { fullName: 'my-org/my-repo', url: 'https://github.com/my-org/my-repo', defaultBranch: 'main' },
      ],
    });

  nock(LAUNCH_HUB_URL)
    .get('/manage/projects/framework')
    .query({ provider: 'GitHub', repoName: 'my-org/my-repo', branchName: 'main', namespace: 'my-org' })
    .reply(200, { framework: 'NEXTJS', buildCommand: 'npm run build', outputDirectory: '.next' });
}

function stubFollowUp(status: string): void {
  nock(LAUNCH_HUB_URL)
    .get(`/manage/projects/${PROJECT_UID}/environments`)
    .query({ limit: 1, skip: 0 })
    .reply(200, {
      pagination: { count: 1, limit: 1, skip: null },
      environments: [{ uid: ENVIRONMENT_UID, name: 'Default', domains: [{ url: 'my-site.example.test' }] }],
    });

  nock(LAUNCH_HUB_URL)
    .get(`/manage/projects/${PROJECT_UID}/environments/${ENVIRONMENT_UID}/deployments`)
    .query({ limit: 1, skip: 0 })
    .reply(200, {
      pagination: { count: 1, limit: 1, skip: null },
      deployments: [{ uid: DEPLOYMENT_UID, deploymentNumber: 1, status: 'QUEUED' }],
    });

  nock(LAUNCH_HUB_URL)
    .get(`/manage/projects/${PROJECT_UID}/environments/${ENVIRONMENT_UID}/deployments/${DEPLOYMENT_UID}`)
    .query({})
    .reply(200, {
      deployment: { uid: DEPLOYMENT_UID, deploymentNumber: 1, status, deploymentUrl: 'my-site.example.test' },
    });
}

describe('integration: launch:projects:create on the wire', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    dataDir = mkdtempSync(join(tmpdir(), 'launch-create-wire-'));
    writeFileSync(join(dataDir, 'index.html'), '<h1>site</h1>');
    recordWire();
    jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
      process.stdout.write(`${String(message)}\n`);
    });
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    rmSync(dataDir, { recursive: true, force: true });
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('posts the create body to /manage/projects, waits for LIVE and exits 0 printing the site url', async () => {
    let body: unknown;
    stubGitLookups();
    const create = nock(LAUNCH_HUB_URL)
      .post('/manage/projects', (sent: unknown) => {
        body = sent;
        return true;
      })
      .query({})
      .reply(201, { project: CREATED_PROJECT });
    stubFollowUp('LIVE');

    const { error, stdout } = await runCommand(gitFlags(), config);

    expect(error).toBeUndefined();
    expect(create.isDone()).toBe(true);
    expect(body).toEqual({
      name: 'My Site',
      projectType: 'GITPROVIDER',
      environment: {
        name: 'Default',
        gitBranch: 'main',
        buildCommand: 'npm run build',
        outputDirectory: '.next',
        frameworkPreset: 'NEXTJS',
        environmentVariables: [],
        isStreamingEnabled: false,
      },
      repository: {
        repositoryName: 'my-org/my-repo',
        username: 'my-org',
        repositoryUrl: 'https://github.com/my-org/my-repo',
        gitProviderMetadata: { gitProvider: 'GitHub' },
      },
    });
    expect(stdout).toContain('✔ Deployment #1 is LIVE');
    expect(stdout).toContain(`uid   ${PROJECT_UID}`);
    expect(stdout).toContain('name  My Site');
    expect(stdout).toContain('type  GITPROVIDER');
    expect(stdout).toContain('url   https://my-site.example.test');
    expect(stdout).not.toContain('test-authtoken');
    expect(onWire).toEqual([]);
  });

  it('exits 1 on a failed deployment, saying the project survived and naming both follow-up commands', async () => {
    stubGitLookups();
    nock(LAUNCH_HUB_URL).post('/manage/projects').query({}).reply(201, { project: CREATED_PROJECT });
    stubFollowUp('FAILED');

    const { error } = await runCommand(gitFlags(), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('its last status was FAILED');
    expect(error?.message).toContain(`The project "My Site" (${PROJECT_UID})`);
    expect(error?.message).toContain('have not been rolled back');
    expect(error?.message).toContain(
      `Run csdx launch:deployments:create --org ${ORG_UID} --project ${PROJECT_UID} --environment ${ENVIRONMENT_UID}`,
    );
    expect(error?.message).toContain(`csdx launch:logs:get --org ${ORG_UID} --project ${PROJECT_UID}`);
    expect(error?.message).toContain(`--deployment ${DEPLOYMENT_UID}`);
    expect(onWire).toEqual([]);
  });

  it('refuses --server-cmd on an unsupported framework with exit 2 before any request', async () => {
    const create = nock(LAUNCH_HUB_URL).post('/manage/projects').query({}).reply(201, { project: CREATED_PROJECT });

    const { error } = await runCommand([...gitFlags(), '--server-cmd', 'npm-start'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is NEXTJS.',
    );
    expect(create.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('refuses a framework outside the documented set with exit 2 before any request', async () => {
    const create = nock(LAUNCH_HUB_URL).post('/manage/projects').query({}).reply(201, { project: CREATED_PROJECT });
    const args = gitFlags();
    args[args.indexOf('NextJs')] = 'Svelte';

    const { error } = await runCommand(args, config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--framework must be one of');
    expect(create.isDone()).toBe(false);
  });

  it('uploads the zipped data dir and creates a FILEUPLOAD project from the upload uid', async () => {
    let body: unknown;
    let uploaded = '';
    const signed = nock(LAUNCH_HUB_URL)
      .get('/manage/projects/upload/signed_url')
      .query({})
      .reply(200, { uploadUrl: `${UPLOAD_HOST}/bucket`, uploadUid: 'upload-uid', method: 'PUT' });
    const upload = nock(UPLOAD_HOST)
      .put('/bucket')
      .reply(200, function (_uri: string, sent: unknown) {
        uploaded = String(sent);
        return '';
      });
    const detect = nock(LAUNCH_HUB_URL)
      .get('/manage/projects/file-framework')
      .query({ uploadUid: 'upload-uid' })
      .reply(200, { framework: 'OTHER' });
    const create = nock(LAUNCH_HUB_URL)
      .post('/manage/projects', (sent: unknown) => {
        body = sent;
        return true;
      })
      .query({})
      .reply(201, { project: { ...CREATED_PROJECT, projectType: 'FILEUPLOAD' } });
    stubFollowUp('DEPLOYED');

    const { error, stdout } = await runCommand(
      [
        'launch:projects:create',
        '--org',
        ORG_UID,
        '--type',
        'FileUpload',
        '--name',
        '"My Site"',
        '--env-name',
        'Default',
        '--framework',
        'Other',
        '--build-cmd',
        '"npm run build"',
        '--output-dir',
        './',
        '--res-mode',
        'buffered',
        '--data-dir',
        dataDir,
      ],
      config,
    );

    expect(error).toBeUndefined();
    expect([signed.isDone(), upload.isDone(), detect.isDone(), create.isDone()]).toEqual([true, true, true, true]);
    expect(uploaded.length).toBeGreaterThan(0);
    expect(body).toMatchObject({
      projectType: 'FILEUPLOAD',
      fileUpload: { uploadUid: 'upload-uid' },
      environment: { uploadUid: 'upload-uid', frameworkPreset: 'OTHER', environmentVariables: [] },
    });
    expect(body).not.toHaveProperty('repository');
    expect(stdout).toContain('✔ Deployment #1 is DEPLOYED');
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming --data-dir when there is no local project directory to upload', async () => {
    const signed = nock(LAUNCH_HUB_URL).get('/manage/projects/upload/signed_url').query({}).reply(200, {});

    const { error } = await runCommand(
      [
        'launch:projects:create',
        '--org',
        ORG_UID,
        '--type',
        'FileUpload',
        '--name',
        '"My Site"',
        '--env-name',
        'Default',
        '--framework',
        'Other',
        '--build-cmd',
        '"npm run build"',
        '--output-dir',
        './',
        '--res-mode',
        'buffered',
        '--data-dir',
        join(dataDir, 'no-such-folder'),
      ],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--data-dir');
    expect(signed.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('asks on a terminal in the pinned order: type, organization, project name, environment name, then the build', async () => {
    const inquired: string[] = [];
    const answers: Record<string, unknown> = {
      'Project type': 'FileUpload',
      'Choose an organization': ORG_UID,
      'Project name': 'My Site',
      'Environment name': 'Default',
      'Framework preset': 'Gatsby',
      'Build command': 'npm run build',
      'Output directory': './public',
      'Response mode': 'buffered',
    };
    jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
      const { message } = payload as { message: string };
      inquired.push(message);
      return answers[message] as never;
    });
    const organizations = nock('https://cma.integration.test')
      .get('/v3/organizations')
      .query({ limit: '100', asc: 'name', include_count: 'true', skip: '0' })
      .reply(200, { organizations: [{ uid: ORG_UID, name: 'Acme' }], count: 1 });
    nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get('/manage/projects/upload/signed_url')
      .query({})
      .reply(200, { uploadUrl: `${UPLOAD_HOST}/bucket`, uploadUid: 'upload-uid', method: 'PUT' });
    nock(UPLOAD_HOST).put('/bucket').reply(200, '');
    nock(LAUNCH_HUB_URL)
      .get('/manage/projects/file-framework')
      .query({ uploadUid: 'upload-uid' })
      .reply(200, { framework: 'GATSBY' });
    const create = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .post('/manage/projects')
      .query({})
      .reply(201, { project: { ...CREATED_PROJECT, projectType: 'FILEUPLOAD' } });
    stubFollowUp('DEPLOYED');
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true });

    const { error } = await runCommand(['launch:projects:create', '--data-dir', dataDir], config).finally(() => {
      if (descriptor === undefined) {
        delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
      } else {
        Object.defineProperty(process.stdin, 'isTTY', descriptor);
      }
    });

    expect(error).toBeUndefined();
    expect(organizations.isDone()).toBe(true);
    expect(create.isDone()).toBe(true);
    expect(inquired).toEqual([
      'Project type',
      'Choose an organization',
      'Project name',
      'Environment name',
      'Framework preset',
      'Build command',
      'Output directory',
      'Response mode',
    ]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming the first missing value when there is no terminal to prompt on', async () => {
    const { error } = await runCommand(['launch:projects:create', '--org', ORG_UID, '--data-dir', dataDir], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('Missing required value for --type. Pass --type or run in an interactive terminal.');
    expect(onWire).toEqual([]);
  });
});
