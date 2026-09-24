import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CancelledError, MissingInputError, UsageError } from '../core/errors';
import { UxLike } from '../core/render';
import { ServiceContext } from '../core/service-context';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { WatchTiming } from '../deployments/deployment.watcher';
import { ApiSurface } from '../resources';
import { CreateRequest, ProjectCreator } from './project.create';
import { UploadFailedError } from './project.errors';

jest.mock('./project.upload', () => ({
  ...jest.requireActual('./project.upload'),
  uploadArchive: jest.fn(async () => undefined),
}));

import { uploadArchive } from './project.upload';

const ORG = 'org1';
const PROJECT_UID = 'p1';
const ENVIRONMENT_UID = 'e1';
const DEPLOYMENT_UID = 'd1';

function advancingTiming(): WatchTiming {
  let clock = 0;

  return {
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    pollDelayMs: 1,
    maxBackoffSteps: 1,
    timeoutMs: 5,
  };
}

interface Scenario {
  isTTY?: boolean;
  answers?: unknown[];
  statuses?: string[];
  environments?: unknown[];
  deployments?: unknown[];
  repositories?: unknown[];
  namespaces?: unknown[];
  branches?: unknown[];
  detected?: unknown;
  createFails?: Error;
  pollFails?: Error;
  createdProject?: unknown;
}

let dataDir: string;

function harness(scenario: Scenario = {}) {
  const printed: string[] = [];
  const asked: unknown[] = [];
  const askedPayloads: Record<string, unknown>[] = [];
  const created: unknown[] = [];
  const gitCalls: unknown[] = [];
  let answerIndex = 0;
  let pollIndex = 0;
  let latestIndex = 0;
  let environmentIndex = 0;

  const statuses = scenario.statuses ?? ['LIVE'];

  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: async (payload: unknown) => {
      asked.push((payload as { message: string }).message);
      askedPayloads.push(payload as Record<string, unknown>);
      const answer = (scenario.answers ?? [])[answerIndex];
      answerIndex += 1;
      return answer as never;
    },
  };

  const api = {
    projects: {
      create: async (params: unknown) => {
        created.push(params);

        if (scenario.createFails) {
          throw scenario.createFails;
        }

        return scenario.createdProject ?? { uid: PROJECT_UID, name: 'My Site', projectType: 'GITPROVIDER' };
      },
      signedUploadUrl: async () => ({ uploadUrl: 'https://uploads.example.test/x', uploadUid: 'upload-uid' }),
      gitFramework: async (params: unknown) => {
        gitCalls.push(params);
        return scenario.detected ?? { framework: 'NEXTJS', buildCommand: 'npm run build', outputDirectory: '.next' };
      },
      fileFramework: async (params: unknown) => {
        gitCalls.push(params);
        return scenario.detected ?? { framework: 'OTHER' };
      },
    },
    environments: {
      first: async () => {
        const list = scenario.environments ?? [{ uid: ENVIRONMENT_UID, name: 'Default', domains: [] }];
        const found = list[Math.min(environmentIndex, list.length - 1)];
        environmentIndex += 1;
        return found;
      },
    },
    deployments: {
      latest: async () => {
        const list = scenario.deployments ?? [{ uid: DEPLOYMENT_UID, deploymentNumber: 1 }];
        const found = list[Math.min(latestIndex, list.length - 1)];
        latestIndex += 1;
        return found;
      },
      get: async () => {
        if (scenario.pollFails) {
          pollIndex += 1;
          throw scenario.pollFails;
        }

        const status = statuses[Math.min(pollIndex, statuses.length - 1)];
        pollIndex += 1;
        return { uid: DEPLOYMENT_UID, deploymentNumber: 1, status, deploymentUrl: 'my-site.example.test' };
      },
    },
    git: {
      namespaces: async () => ({
        pagination: { count: 1, limit: 100 },
        namespaces: scenario.namespaces ?? [{ name: 'my-org' }],
      }),
      repositories: async (params: unknown) => {
        gitCalls.push(params);
        return {
          pagination: { count: 1, limit: 100 },
          repositories: scenario.repositories ?? [
            { fullName: 'my-org/my-repo', url: 'https://github.com/my-org/my-repo', defaultBranch: 'main' },
          ],
        };
      },
      branches: async () => ({
        pagination: { count: 1, limit: 100 },
        branches: scenario.branches ?? [{ name: 'main' }],
      }),
    },
  } as unknown as ApiSurface;

  const services: ServiceContext = { api, ux, isTTY: scenario.isTTY ?? false };

  return { creator: new ProjectCreator(services, advancingTiming()), printed, asked, askedPayloads, created, gitCalls };
}

function configPathIn(dir: string): string {
  return join(dir, '.cs-launch.json');
}

function configFileIn(dir: string): unknown {
  return JSON.parse(readFileSync(configPathIn(dir), 'utf8'));
}

function gitRequest(overrides: Partial<CreateRequest> = {}): CreateRequest {
  return {
    org: ORG,
    dataDir,
    type: 'GitHub',
    name: 'My Site',
    envName: 'Default',
    namespace: 'my-org',
    repo: 'my-org/my-repo',
    branch: 'main',
    framework: 'NextJs',
    buildCmd: 'npm run build',
    outputDir: '.next',
    resMode: 'buffered',
    ...overrides,
  };
}

function uploadRequest(overrides: Partial<CreateRequest> = {}): CreateRequest {
  return {
    org: ORG,
    dataDir,
    type: 'FileUpload',
    name: 'My Site',
    envName: 'Default',
    framework: 'Other',
    buildCmd: 'npm run build',
    outputDir: './',
    resMode: 'buffered',
    ...overrides,
  };
}

function bodyOf(created: unknown[]): Record<string, unknown> {
  return (created[0] as { input: Record<string, unknown> }).input;
}

describe('ProjectCreator on the GitHub path', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'launch-create-'));
    writeFileSync(join(dataDir, 'index.html'), '<h1>site</h1>');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('sends the documented create body and reports the created project with its site url', async () => {
    const { creator, created, printed } = harness();

    await creator.create(gitRequest());

    expect(bodyOf(created)).toEqual({
      name: 'My Site',
      projectType: 'GITPROVIDER',
      environment: {
        name: 'Default',
        gitBranch: 'main',
        uploadUid: undefined,
        buildCommand: 'npm run build',
        outputDirectory: '.next',
        serverCommand: undefined,
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
    expect(printed).toEqual([
      '✔ Deployment #1 is LIVE',
      'uid   p1',
      'name  My Site',
      'type  GITPROVIDER',
      'url   https://my-site.example.test',
    ]);
  });

  it('sends the project description and the two toggles only when they were supplied', async () => {
    const { creator, created } = harness();

    await creator.create(
      gitRequest({ description: 'A site', autoDeploy: 'enable', csAuth: 'disable', resMode: 'streaming' }),
    );
    const body = bodyOf(created);

    expect(body.description).toBe('A site');
    expect(body.environment).toMatchObject({
      autoDeployOnPush: true,
      isContentstackAuthenticationEnabled: false,
      isStreamingEnabled: true,
    });
  });

  it('leaves the optional fields out of the body when they were not supplied', async () => {
    const { creator, created } = harness();

    await creator.create(gitRequest());
    const body = bodyOf(created);

    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('fileUpload');
    expect(body.environment).not.toHaveProperty('autoDeployOnPush');
    expect(body.environment).not.toHaveProperty('isContentstackAuthenticationEnabled');
  });

  it('always sends an empty environmentVariables array, whatever else it was handed', async () => {
    const { creator, created } = harness();

    await creator.create({
      ...gitRequest(),
      ...({ var: 'SECRET=hunter2', 'env-file': '.env', 'from-stack': 'blt1' } as object),
    } as CreateRequest);
    const environment = bodyOf(created).environment as Record<string, unknown>;

    expect(environment.environmentVariables).toEqual([]);
    expect(JSON.stringify(created)).not.toContain('hunter2');
  });

  it('detects the framework from the chosen repository and branch', async () => {
    const { creator, gitCalls } = harness();

    await creator.create(gitRequest());

    expect(gitCalls).toContainEqual({
      org: ORG,
      provider: 'GitHub',
      repoName: 'my-org/my-repo',
      branchName: 'main',
      namespace: 'my-org',
    });
  });

  it('derives a repository url when the Git provider did not return one', async () => {
    const { creator, created } = harness({ repositories: [{ fullName: 'my-org/my-repo' }] });

    await creator.create(gitRequest());

    expect((bodyOf(created).repository as Record<string, string>).repositoryUrl).toBe(
      'https://github.com/my-org/my-repo',
    );
  });

  it('refuses a --repo that the namespace does not hold', async () => {
    const { creator } = harness({ repositories: [{ fullName: 'my-org/other-repo' }] });

    await expect(creator.create(gitRequest({ repo: 'my-org/missing' }))).rejects.toThrow(UsageError);
    await expect(creator.create(gitRequest({ repo: 'my-org/missing' }))).rejects.toThrow(
      'No repository named "my-org/missing" was found under "my-org".',
    );
  });

  it('accepts a --repo given as the bare repository name', async () => {
    const { creator, created } = harness({ repositories: [{ name: 'my-repo', url: 'https://github.com/x/my-repo' }] });

    await creator.create(gitRequest({ repo: 'my-repo' }));

    expect((bodyOf(created).repository as Record<string, string>).repositoryName).toBe('my-repo');
  });
});

describe('ProjectCreator prompting order and refusals', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'launch-create-'));
    writeFileSync(join(dataDir, 'index.html'), '<h1>site</h1>');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('asks in the order the doc pins: type, project name, environment name, framework, build, output, response', async () => {
    const { creator, asked } = harness({
      isTTY: true,
      answers: ['GitHub', 'My Site', 'Default', 'my-org', 'my-org/my-repo', 'main', 'NextJs', 'npm run build', '.next', 'buffered'],
    });

    await creator.create({ org: ORG, dataDir });

    expect(asked).toEqual([
      'Project type',
      'Project name',
      'Environment name',
      'Choose a Git namespace',
      'Choose a repository',
      'Choose a branch',
      'Framework preset',
      'Build command',
      'Output directory',
      'Response mode',
    ]);
  });

  it.each([
    ['type', {}],
    ['name', { type: 'GitHub' }],
    ['env-name', { type: 'GitHub', name: 'My Site' }],
    ['namespace', { type: 'GitHub', name: 'My Site', envName: 'Default' }],
  ])('exits 2 naming --%s when there is no terminal to ask on', async (flag, supplied) => {
    const { creator } = harness();

    const failure = await creator.create({ org: ORG, dataDir, ...supplied }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(MissingInputError);
    expect((failure as MissingInputError).flag).toBe(flag);
    expect((failure as MissingInputError).exitCode).toBe(2);
  });

  it('exits 2 naming --framework when nothing detected can be offered without a terminal', async () => {
    const { creator } = harness();

    const failure = await creator
      .create(gitRequest({ framework: undefined }))
      .catch((error: Error) => error);

    expect(failure).toBeInstanceOf(MissingInputError);
    expect((failure as MissingInputError).flag).toBe('framework');
  });

  it('offers the detected framework as the default rather than choosing it outright', async () => {
    const { creator, asked, created } = harness({
      isTTY: true,
      answers: ['Astro', 'npm run build', 'dist', 'npm start', 'buffered'],
      detected: { framework: 'NEXTJS', buildCommand: 'npm run build', outputDirectory: '.next' },
    });

    await creator.create(gitRequest({ framework: undefined, buildCmd: undefined, outputDir: undefined, resMode: undefined }));

    expect(asked[0]).toBe('Framework preset');
    expect((bodyOf(created).environment as Record<string, unknown>).frameworkPreset).toBe('ASTRO');
  });

  it('offers ./ as the output directory default when the service detected none', async () => {
    const { creator, created } = harness({
      isTTY: true,
      answers: ['./'],
      detected: { framework: 'OTHER', buildCommand: 'npm run build' },
    });

    await creator.create(uploadRequest({ outputDir: undefined, framework: 'Gatsby' }));

    expect((bodyOf(created).environment as Record<string, unknown>).outputDirectory).toBe('./');
  });

  it('offers the detected framework as a default the picker can actually match', async () => {
    const { creator, askedPayloads } = harness({
      isTTY: true,
      answers: ['Gatsby'],
      detected: { framework: 'NEXTJS', buildCommand: 'npm run build', outputDirectory: '.next' },
    });

    await creator.create(gitRequest({ framework: undefined }));

    const choices = askedPayloads[0].choices as { value: string }[];

    expect(askedPayloads[0].default).toBe('NextJs');
    expect(choices.map((choice) => choice.value)).toContain(askedPayloads[0].default);
  });

  it.each([['SvelteKit'], ['SolidStart'], ['Qwik'], ['']])(
    'suggests nothing and still creates the project when the service detected the unknown framework %p',
    async (framework) => {
      const { creator, askedPayloads, created } = harness({
        isTTY: true,
        answers: ['Gatsby'],
        detected: { framework, buildCommand: 'npm run build', outputDirectory: 'dist' },
      });

      await creator.create(gitRequest({ framework: undefined }));

      expect(askedPayloads[0].default).toBeUndefined();
      expect((bodyOf(created).environment as Record<string, unknown>).frameworkPreset).toBe('GATSBY');
    },
  );

  it('suggests nothing when the service detected a framework that is not a string', async () => {
    const { creator, askedPayloads } = harness({
      isTTY: true,
      answers: ['Gatsby'],
      detected: { framework: 42, buildCommand: 'npm run build', outputDirectory: 'dist' },
    });

    await creator.create(gitRequest({ framework: undefined }));

    expect(askedPayloads[0].default).toBeUndefined();
  });

  it('offers no framework default when the service detected nothing', async () => {
    const { creator, created } = harness({ isTTY: true, answers: ['Other', 'npm start'], detected: {} });

    await creator.create(gitRequest({ framework: undefined }));

    expect((bodyOf(created).environment as Record<string, unknown>).frameworkPreset).toBe('OTHER');
  });

  it('cancels with exit 3 when nothing is picked at a prompt', async () => {
    const { creator } = harness({ isTTY: true, answers: [undefined] });

    const failure = await creator.create({ org: ORG, dataDir }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(CancelledError);
    expect((failure as CancelledError).exitCode).toBe(3);
  });

  it('asks for a server command only for a framework that supports one', async () => {
    const supported = harness({ isTTY: true, answers: ['npm start'] });
    await supported.creator.create(gitRequest({ framework: 'Remix', serverCmd: undefined }));

    expect(supported.asked).toEqual(['Server command']);
    expect((bodyOf(supported.created).environment as Record<string, unknown>).serverCommand).toBe('npm start');

    const unsupported = harness({ isTTY: true, answers: [] });
    await unsupported.creator.create(gitRequest({ framework: 'NextJs', serverCmd: undefined }));

    expect(unsupported.asked).toEqual([]);
    expect((bodyOf(unsupported.created).environment as Record<string, unknown>).serverCommand).toBeUndefined();
  });

  it('sends a supplied server command for a supported framework without asking', async () => {
    const { creator, asked, created } = harness({ isTTY: true });

    await creator.create(gitRequest({ framework: 'Nuxt', serverCmd: 'npm run start' }));

    expect(asked).toEqual([]);
    expect((bodyOf(created).environment as Record<string, unknown>).serverCommand).toBe('npm run start');
  });

  it('sends no server command for a supported framework when there is no terminal to ask on', async () => {
    const { creator, created } = harness();

    await creator.create(gitRequest({ framework: 'Other', serverCmd: undefined }));

    expect((bodyOf(created).environment as Record<string, unknown>).serverCommand).toBeUndefined();
  });
});

describe('ProjectCreator on the FileUpload path', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'launch-create-'));
    writeFileSync(join(dataDir, 'index.html'), '<h1>site</h1>');
    (uploadArchive as jest.Mock).mockClear();
    (uploadArchive as jest.Mock).mockImplementation(async () => undefined);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('zips the data dir, uploads it, and creates the project with the upload uid', async () => {
    const { creator, created, printed, gitCalls } = harness();

    await creator.create(uploadRequest());

    expect(uploadArchive).toHaveBeenCalledTimes(1);
    expect(bodyOf(created)).toMatchObject({
      projectType: 'FILEUPLOAD',
      fileUpload: { uploadUid: 'upload-uid' },
      environment: { uploadUid: 'upload-uid', gitBranch: undefined },
    });
    expect(bodyOf(created)).not.toHaveProperty('repository');
    expect(gitCalls).toContainEqual({ org: ORG, uploadUid: 'upload-uid' });
    expect(printed[0]).toBe(`Uploading 1 files from ${dataDir}`);
  });

  it('creates the project with no server command when the optional prompt is left empty', async () => {
    for (const answer of ['', '   ', undefined, null]) {
      (uploadArchive as jest.Mock).mockClear();
      const { creator, created, asked } = harness({ isTTY: true, answers: [answer] });

      await creator.create(uploadRequest({ framework: 'Other', serverCmd: undefined }));

      expect(asked).toEqual(['Server command']);
      expect(uploadArchive).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect((bodyOf(created).environment as Record<string, unknown>).serverCommand).toBeUndefined();
    }
  });

  it('creates the project with no build command when the optional prompt is left empty', async () => {
    for (const answer of ['', '   ', undefined, null]) {
      const { creator, created, asked, askedPayloads } = harness({ isTTY: true, answers: [answer] });

      await creator.create(uploadRequest({ buildCmd: undefined, serverCmd: 'npm start' }));

      expect(asked).toEqual(['Build command']);
      expect(askedPayloads[0].default).toBeUndefined();
      expect(created).toHaveLength(1);
      expect((bodyOf(created).environment as Record<string, unknown>).buildCommand).toBeUndefined();
    }
  });

  it('trims a build command and a server command typed at their optional prompts', async () => {
    const { creator, created } = harness({ isTTY: true, answers: ['  npm run build  ', ' npm start '] });

    await creator.create(uploadRequest({ buildCmd: undefined, serverCmd: undefined }));

    expect(bodyOf(created).environment).toMatchObject({ buildCommand: 'npm run build', serverCommand: 'npm start' });
  });

  it('exits 2 naming --data-dir rather than uploading the wrong contents', async () => {
    const { creator } = harness();

    const failure = await creator
      .create(uploadRequest({ dataDir: join(dataDir, 'no-such-folder') }))
      .catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as UsageError).message).toContain('--data-dir');
    expect(uploadArchive).not.toHaveBeenCalled();
  });

  it('exits 2 without uploading when the directory holds nothing but excluded paths', async () => {
    rmSync(join(dataDir, 'index.html'));
    writeFileSync(join(dataDir, '.env'), 'SECRET=1');
    const { creator } = harness();

    await expect(creator.create(uploadRequest())).rejects.toThrow('Nothing to upload');
    expect(uploadArchive).not.toHaveBeenCalled();
  });

  it('propagates an upload that fails midway rather than creating a project from it', async () => {
    (uploadArchive as jest.Mock).mockImplementation(async () => {
      throw new UploadFailedError('The upload of your project files failed: socket hang up');
    });
    const { creator, created } = harness();

    const failure = await creator.create(uploadRequest()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UploadFailedError);
    expect((failure as UploadFailedError).exitCode).toBe(1);
    expect(created).toEqual([]);
  });
});

describe('ProjectCreator waiting on the first deployment', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'launch-create-'));
    writeFileSync(join(dataDir, 'index.html'), '<h1>site</h1>');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('streams every status change until the deployment is live', async () => {
    const { creator, printed } = harness({ statuses: ['QUEUED', 'DEPLOYING', 'LIVE'] });

    await creator.create(gitRequest());

    expect(printed.slice(0, 3)).toEqual([
      '→ Deployment #1 is QUEUED',
      '→ Deployment #1 is DEPLOYING',
      '✔ Deployment #1 is LIVE',
    ]);
  });

  it('treats DEPLOYED as a success as well as LIVE', async () => {
    const { creator, printed } = harness({ statuses: ['DEPLOYED'] });

    await creator.create(gitRequest());

    expect(printed).toContain('✔ Deployment #1 is DEPLOYED');
    expect(printed).toContain('url   https://my-site.example.test');
  });

  it('exits 1 on a failed deployment, saying what survived and how to retry and inspect it', async () => {
    const { creator } = harness({ statuses: ['DEPLOYING', 'FAILED'] });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as DeploymentUnsuccessfulError).exitCode).toBe(1);
    expect((failure as Error).message).toBe(
      'The deployment did not succeed; its last status was FAILED. ' +
        'The project "My Site" (p1) and its environment "Default" were created and have not been rolled back. ' +
        'Run csdx launch:deployments:create --org org1 --project p1 --environment e1 to try the deployment again, ' +
        'or csdx launch:logs:get --org org1 --project p1 --environment e1 --deployment d1 ' +
        'to see why it did not succeed.',
    );
  });

  it('exits 1 when the deployment never left DEPLOYING within the timeout', async () => {
    const { creator } = harness({ statuses: ['DEPLOYING'] });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as Error).message).toContain('its last status was DEPLOYING');
  });

  it('exits 1 naming no deployment when the API reported none to wait on', async () => {
    const { creator } = harness({ deployments: [undefined] });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as Error).message).toContain('its last status was NONE');
    expect((failure as Error).message).not.toContain('--deployment');
  });

  it('waits for the first deployment to appear rather than calling an empty page a failure', async () => {
    const { creator, printed } = harness({ deployments: [undefined, { uid: DEPLOYMENT_UID, deploymentNumber: 1 }] });

    await creator.create(gitRequest());

    expect(printed).toContain('✔ Deployment #1 is LIVE');
  });

  it('waits for the first environment to appear rather than calling an empty page a failure', async () => {
    const { creator, printed } = harness({
      environments: [undefined, { uid: ENVIRONMENT_UID, name: 'Default', domains: [] }],
    });

    await creator.create(gitRequest());

    expect(printed).toContain('✔ Deployment #1 is LIVE');
  });

  it('exits 1 disclosing what survived when the wait itself failed outright', async () => {
    const { creator } = harness({ pollFails: new Error('The Launch API answered 502 Bad Gateway.') });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as DeploymentUnsuccessfulError).exitCode).toBe(1);
    expect((failure as Error).message).toContain('The Launch API answered 502 Bad Gateway.');
    expect((failure as Error).message).toContain('have not been rolled back');
    expect((failure as Error).message).toContain('--org org1 --project p1');
    expect((failure as Error).message).toContain('--environment e1');
    expect((failure as Error).message).toContain('--deployment d1');
  });

  it('exits 1 disclosing what survived when the wait failed with something that is not an Error', async () => {
    const { creator } = harness({ pollFails: 'socket hang up' as unknown as Error });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as Error).message).toContain('socket hang up.');
    expect((failure as Error).message).toContain('have not been rolled back');
  });

  it('exits 1 naming no environment when the API reported none either', async () => {
    const { creator } = harness({ environments: [undefined] });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect((failure as Error).message).toContain('its environment "Default"');
    expect((failure as Error).message).not.toContain('--environment');
  });

  it('falls back to the environment domain when the deployment carries no url', async () => {
    const { creator, printed } = harness({
      environments: [{ uid: ENVIRONMENT_UID, name: 'Default', domains: [{}, { url: 'domain.example.test' }] }],
    });
    const { creator: creator2 } = harness();
    expect(creator2).toBeDefined();

    jest
      .spyOn(
        (creator as unknown as { services: { api: { deployments: { get: () => unknown } } } }).services.api.deployments,
        'get',
      )
      .mockResolvedValue({ uid: DEPLOYMENT_UID, deploymentNumber: 1, status: 'LIVE' } as never);

    await creator.create(gitRequest());

    expect(printed).toContain('url   https://domain.example.test');
  });

  it('reports no url at all when neither the deployment nor the environment has one', async () => {
    const { creator, printed } = harness({ environments: [{ uid: ENVIRONMENT_UID, name: 'Default' }] });

    jest
      .spyOn(
        (creator as unknown as { services: { api: { deployments: { get: () => unknown } } } }).services.api.deployments,
        'get',
      )
      .mockResolvedValue({ uid: DEPLOYMENT_UID, deploymentNumber: 1, status: 'LIVE' } as never);

    await creator.create(gitRequest());

    expect(printed).not.toContain('url');
    expect(printed.join('\n')).not.toContain('undefined');
  });

  it('names the project by its uid when the API returned one with no name', async () => {
    const { creator } = harness({ statuses: ['FAILED'] });
    jest
      .spyOn(
        (creator as unknown as { services: { api: { projects: { create: () => unknown } } } }).services.api.projects,
        'create',
      )
      .mockResolvedValue({ uid: PROJECT_UID, projectType: 'GITPROVIDER' } as never);

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect((failure as Error).message).toContain(`The project "${PROJECT_UID}" (${PROJECT_UID})`);
    expect((failure as Error).message).not.toContain('undefined');
  });

  it('names the environment by the name it asked for when the API returned one with no name', async () => {
    const { creator } = harness({ statuses: ['FAILED'], environments: [{ uid: ENVIRONMENT_UID }] });

    const failure = await creator.create(gitRequest()).catch((error: Error) => error);

    expect((failure as Error).message).toContain('its environment "Default"');
    expect((failure as Error).message).not.toContain('undefined');
  });

  it('propagates a create failure without waiting on anything', async () => {
    const boom = new UsageError('A project with that name already exists in this organization.');
    const { creator, printed } = harness({ createFails: boom });

    await expect(creator.create(gitRequest())).rejects.toBe(boom);
    expect(printed).toEqual([]);
  });
});

describe('ProjectCreator writing the project config', () => {
  beforeEach(() => {
    (uploadArchive as jest.Mock).mockImplementation(async () => undefined);
    dataDir = mkdtempSync(join(tmpdir(), 'launch-create-'));
    writeFileSync(join(dataDir, 'index.html'), '<h1>site</h1>');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes the created project into .cs-launch.json on the GitHub path', async () => {
    const { creator } = harness();

    await creator.create(gitRequest({ configPath: configPathIn(dataDir) }));

    expect(configFileIn(dataDir)).toEqual({
      project: { uid: PROJECT_UID, organizationUid: ORG, name: 'My Site' },
    });
  });

  it('writes the created project into .cs-launch.json on the FileUpload path', async () => {
    const { creator } = harness();

    await creator.create(uploadRequest({ configPath: configPathIn(dataDir) }));

    expect(configFileIn(dataDir)).toEqual({
      project: { uid: PROJECT_UID, organizationUid: ORG, name: 'My Site' },
    });
  });

  it('keeps every other branch block in an existing multi-branch file', async () => {
    writeFileSync(
      configPathIn(dataDir),
      JSON.stringify({
        main: { uid: PROJECT_UID, organizationUid: ORG, environments: [{ uid: 'e1', name: 'Default' }] },
        'feature/checkout': { uid: PROJECT_UID, organizationUid: ORG, environments: [{ uid: 'e2', name: 'Preview' }] },
      }),
    );
    const { creator } = harness();

    await creator.create(gitRequest({ configPath: configPathIn(dataDir) }));

    expect(configFileIn(dataDir)).toEqual({
      main: {
        uid: PROJECT_UID,
        organizationUid: ORG,
        name: 'My Site',
        environments: [{ uid: 'e1', name: 'Default' }],
      },
      'feature/checkout': {
        uid: PROJECT_UID,
        organizationUid: ORG,
        name: 'My Site',
        environments: [{ uid: 'e2', name: 'Preview' }],
      },
    });
  });

  it('reports the miss and leaves the file alone when it already names a different project', async () => {
    const existing = { project: { uid: 'other-project', organizationUid: ORG, name: 'Other Site' } };
    writeFileSync(configPathIn(dataDir), JSON.stringify(existing));
    const { creator, printed } = harness();

    await expect(creator.create(gitRequest({ configPath: configPathIn(dataDir) }))).resolves.toBeUndefined();

    expect(configFileIn(dataDir)).toEqual(existing);
    expect(printed).toContain(
      `Could not record this project in ${configPathIn(dataDir)}: ` +
        `The config file at '${configPathIn(dataDir)}' already names project other-project. ` +
        'Delete it or pass --config with another path. ' +
        'Pass --org and --project explicitly when you run Launch commands in this folder.',
    );
  });

  it('reports the miss and still reports the created project when the file cannot be written', async () => {
    const unwritable = join(dataDir, 'no-such-folder', '.cs-launch.json');
    const { creator, printed } = harness();

    await expect(creator.create(gitRequest({ configPath: unwritable }))).resolves.toBeUndefined();

    expect(printed.some((line) => line.startsWith(`Could not record this project in ${unwritable}:`))).toBe(true);
    expect(printed.some((line) => line.includes(PROJECT_UID))).toBe(true);
  });

  it('omits the project name when the api returns a project without one', async () => {
    const { creator } = harness({ createdProject: { uid: PROJECT_UID } });

    await creator.create(gitRequest({ configPath: configPathIn(dataDir) }));

    expect(configFileIn(dataDir)).toEqual({ project: { uid: PROJECT_UID, organizationUid: ORG } });
  });

  it('writes nothing at all when no config path was supplied', async () => {
    const { creator } = harness();

    await creator.create(gitRequest());

    expect(existsSync(configPathIn(dataDir))).toBe(false);
  });
});
