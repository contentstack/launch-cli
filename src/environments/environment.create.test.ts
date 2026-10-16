import { MissingInputError } from '../core/errors';
import type { ServiceContext } from '../core/service-context';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { DeploymentFollower } from '../deployments/deployment.follower';
import type { WatchTiming } from '../deployments/deployment.watcher';
import { LaunchApiError } from '../transport/errors';
import { FolderUploader } from '../uploads/upload.folder';
import type { EnvironmentCreateRequest } from './environment.create';
import { EnvironmentCreator } from './environment.create';

const TIMING: WatchTiming = { sleep: async () => undefined, now: () => 0, pollDelayMs: 1, maxBackoffSteps: 1, timeoutMs: 10 };

const GITHUB_PROJECT = {
  uid: 'proj1',
  projectType: 'GITPROVIDER',
  repository: { repositoryName: 'octo-user/site', username: 'octo-user', gitProvider: 'GitHub' },
};

const UPLOAD_PROJECT = { uid: 'proj1', projectType: 'FILEUPLOAD' };

interface Harness {
  isTTY?: boolean;
  project?: unknown;
  outcome?: { kind: 'success' | 'failure' | 'timed-out'; status: string };
  answers?: Record<string, unknown>;
  detectFails?: Error;
  noDeployment?: boolean;
  deploymentAfterLooks?: number;
  latestFails?: Error;
  watchFails?: Error;
  createFails?: Error;
  createdEnvironment?: unknown;
}

function creatorUnderTest(harness: Harness = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const asked: string[] = [];
  const created: unknown[] = [];
  const slept: number[] = [];
  let looks = 0;

  const services = {
    isTTY: harness.isTTY ?? false,
    outputIsTTY: false,
    ux: {
      print: (message: string) => {
        lines.push(message);
      },
      inquire: async (payload: { message: string }) => {
        asked.push(payload.message);
        return harness.answers?.[payload.message];
      },
    },
    api: {
      projects: {
        get: async (params: unknown) => {
          calls.push(`project ${JSON.stringify(params)}`);
          return harness.project ?? GITHUB_PROJECT;
        },
        gitFramework: async (params: unknown) => {
          calls.push(`gitFramework ${JSON.stringify(params)}`);
          if (harness.detectFails) {
            throw harness.detectFails;
          }
          return { framework: 'NEXTJS', buildCommand: 'npm run build', outputDirectory: './.next' };
        },
        fileFramework: async (params: unknown) => {
          calls.push(`fileFramework ${JSON.stringify(params)}`);
          if (harness.detectFails) {
            throw harness.detectFails;
          }
          return { framework: 'GATSBY', buildCommand: 'gatsby build', outputDirectory: './public' };
        },
      },
      git: {
        branches: async (params: unknown) => {
          calls.push(`branches ${JSON.stringify(params)}`);
          return { pagination: { count: 2 }, branches: [{ name: 'main' }, { name: 'develop' }] };
        },
      },
      environments: {
        create: async (params: unknown) => {
          calls.push('create');
          created.push(params);
          if (harness.createFails) {
            throw harness.createFails;
          }
          return harness.createdEnvironment ?? { uid: 'env9', name: 'staging' };
        },
        get: async (params: unknown) => {
          calls.push(`get ${JSON.stringify(params)}`);
          return { uid: 'env9', name: 'staging', domains: [{ url: 'https://staging.example.test' }] };
        },
      },
      deployments: {
        latest: async (params: unknown) => {
          calls.push(`latest ${JSON.stringify(params)}`);
          if (harness.latestFails) {
            throw harness.latestFails;
          }
          looks += 1;
          if (harness.noDeployment || looks <= (harness.deploymentAfterLooks ?? 0)) {
            return undefined;
          }
          return { uid: 'dep1', status: 'QUEUED' };
        },
      },
    },
  } as unknown as ServiceContext;

  jest.spyOn(FolderUploader.prototype, 'upload').mockImplementation(async (scope, dataDir, excluded) => {
    calls.push(`upload ${JSON.stringify({ scope, dataDir, excluded })}`);
    return 'upl1';
  });
  jest.spyOn(DeploymentFollower.prototype, 'watch').mockImplementation(async (scope) => {
    calls.push(`watch ${JSON.stringify(scope)}`);
    if (harness.watchFails) {
      throw harness.watchFails;
    }
    const outcome = harness.outcome ?? { kind: 'success', status: 'LIVE' };
    return { ...outcome, deployment: { uid: 'dep1', status: outcome.status } };
  });
  jest.spyOn(DeploymentFollower.prototype, 'announceLive').mockImplementation(async (deployment, domains) => {
    calls.push(`announce ${JSON.stringify({ deployment, domains })}`);
  });

  const timing: WatchTiming = {
    ...TIMING,
    pollDelayMs: 250,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };

  return { creator: new EnvironmentCreator(services, timing), calls, lines, asked, created, slept };
}

function request(fields: Partial<EnvironmentCreateRequest> = {}): EnvironmentCreateRequest {
  return {
    org: 'org1',
    project: 'proj1',
    dataDir: '/work/site',
    configPath: '/work/site/.cs-launch.json',
    name: 'staging',
    branch: 'develop',
    resMode: 'buffered',
    ...fields,
  };
}

describe('EnvironmentCreator', () => {
  it('creates a GitHub environment and follows its first deployment, ending on the live announcement', async () => {
    const { creator, calls, lines, created } = creatorUnderTest();

    await creator.create(request({ description: 'pre-release', csAuth: 'disable' }));

    expect(calls).toEqual([
      'project {"org":"org1","project":"proj1"}',
      'gitFramework {"org":"org1","provider":"GitHub","repoName":"octo-user/site","branchName":"develop","namespace":"octo-user"}',
      'create',
      'latest {"org":"org1","project":"proj1","environment":"env9"}',
      'watch {"org":"org1","project":"proj1","environment":"env9","deployment":"dep1"}',
      'announce {"deployment":{"uid":"dep1","status":"LIVE"}}',
    ]);
    expect(created).toEqual([
      {
        org: 'org1',
        project: 'proj1',
        input: {
          name: 'staging',
          description: 'pre-release',
          gitBranch: 'develop',
          buildCommand: 'npm run build',
          outputDirectory: './.next',
          frameworkPreset: 'NEXTJS',
          environmentVariables: [],
          isStreamingEnabled: false,
          isContentstackAuthenticationEnabled: false,
        },
      },
    ]);
    expect(lines[lines.length - 1]).toBe('✔ Environment created successfully.');
    expect(lines.some((line) => line.includes('│'))).toBe(false);
  });

  it('uploads the data dir without the config file and creates a FileUpload environment from the upload', async () => {
    const { creator, calls, created } = creatorUnderTest({ project: UPLOAD_PROJECT });

    await creator.create(request({ branch: undefined }));

    expect(calls.slice(0, 4)).toEqual([
      'project {"org":"org1","project":"proj1"}',
      'upload {"scope":{"org":"org1","project":"proj1"},"dataDir":"/work/site","excluded":["/work/site/.cs-launch.json"]}',
      'fileFramework {"org":"org1","uploadUid":"upl1"}',
      'create',
    ]);
    expect(created).toEqual([
      {
        org: 'org1',
        project: 'proj1',
        input: {
          name: 'staging',
          uploadUid: 'upl1',
          buildCommand: 'gatsby build',
          outputDirectory: './public',
          frameworkPreset: 'GATSBY',
          environmentVariables: [],
          isStreamingEnabled: false,
        },
      },
    ]);
  });

  it.each([
    [{ branch: 'develop' }, '--branch'],
    [{ branch: undefined, autoDeploy: 'enable' as const }, '--auto-deploy'],
  ])('warns that %p does not apply to a FileUpload project, before uploading, and creates without it', async (fields, flag) => {
    const { creator, calls, lines, created } = creatorUnderTest({ project: UPLOAD_PROJECT });

    await creator.create(request(fields));

    expect(lines[0]).toBe(`warn: ${flag} is not supported for FileUpload projects.`);
    expect(calls[1]).toMatch(/^upload /);
    expect(created).toEqual([
      expect.objectContaining({
        input: expect.not.objectContaining({ gitBranch: expect.anything(), autoDeployOnPush: expect.anything() }),
      }),
    ]);
  });

  it.each([
    [{ name: undefined }, 'name'],
    [{ branch: undefined }, 'branch'],
  ])('refuses %p off a terminal naming the flag, before detecting or creating anything', async (fields, flag) => {
    const { creator, calls } = creatorUnderTest();

    const failure = await creator.create(request(fields)).catch((error: unknown) => error);

    expect(failure).toEqual(new MissingInputError(flag, { config: false, prompt: true }));
    expect(calls).toEqual(['project {"org":"org1","project":"proj1"}']);
  });

  it('asks in the pinned order on a terminal: name, branch, then the build settings', async () => {
    const { creator, calls, asked, created } = creatorUnderTest({
      isTTY: true,
      answers: {
        'Environment name': 'staging',
        'Choose a branch': 'develop',
        'Framework preset': 'NextJs',
        'Build command': 'npm run build',
        'Output directory': './.next',
        'Response mode': 'streaming',
        'Contentstack Authentication': 'enable',
      },
    });

    await creator.create(request({ name: undefined, branch: undefined, resMode: undefined }));

    expect(asked).toEqual([
      'Environment name',
      'Choose a branch',
      'Framework preset',
      'Build command',
      'Output directory',
      'Response mode',
      'Contentstack Authentication',
    ]);
    expect(calls[1]).toBe(
      'branches {"org":"org1","provider":"GitHub","namespace":"octo-user","repoName":"octo-user/site","limit":100,"skip":0}',
    );
    expect(created).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({ name: 'staging', gitBranch: 'develop', isStreamingEnabled: true }),
      }),
    ]);
  });

  it('asks the FileUpload name only after the folder has been uploaded', async () => {
    const { creator, calls, asked } = creatorUnderTest({
      project: UPLOAD_PROJECT,
      isTTY: true,
      answers: { 'Environment name': 'staging', 'Contentstack Authentication': 'enable' },
    });

    await creator.create(request({ name: undefined, branch: undefined, framework: 'GATSBY', buildCmd: 'b', outputDir: 'o' }));

    expect(calls[1]).toMatch(/^upload /);
    expect(asked).toEqual(['Environment name', 'Contentstack Authentication']);
  });

  it.each([
    [{ uid: 'proj1', projectType: 'GITPROVIDER' }],
    [{ uid: 'proj1', projectType: 'GITPROVIDER', repository: { username: 'octo-user' } }],
    [{ uid: 'proj1', projectType: 'GITPROVIDER', repository: { repositoryName: 'octo-user/site', username: ' ' } }],
  ])('reports a GitHub project %p without its repository as a malformed response, asking nothing', async (project) => {
    const { creator, asked, calls } = creatorUnderTest({ project, isTTY: true, answers: { 'Environment name': 'x' } });

    const failure = await creator.create(request({ branch: undefined })).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect((failure as Error).message).toBe(
      'The Launch API returned a GitHub project without its repository name and owner.',
    );
    expect(asked).toEqual([]);
    expect(calls).toEqual(['project {"org":"org1","project":"proj1"}']);
  });

  it('takes the provider as GitHub when the project does not name one', async () => {
    const { creator, calls } = creatorUnderTest({
      project: { uid: 'proj1', projectType: 'GITPROVIDER', repository: { repositoryName: 'octo-user/site', username: 'octo-user' } },
    });

    await creator.create(request());

    expect(calls[1]).toContain('"provider":"GitHub"');
  });

  it.each([[GITHUB_PROJECT], [UPLOAD_PROJECT]])(
    'treats a 404 from framework detection as nothing detected and builds from the flags (%p)',
    async (project) => {
      const detectFails = new LaunchApiError(404, []);
      const { creator, created } = creatorUnderTest({ project, detectFails });

      await creator.create(
        request({ branch: project === UPLOAD_PROJECT ? undefined : 'develop', framework: 'OTHER', outputDir: './out' }),
      );

      expect(created).toEqual([
        expect.objectContaining({ input: expect.objectContaining({ frameworkPreset: 'OTHER', outputDirectory: './out' }) }),
      ]);
    },
  );

  it('refuses off a terminal naming --framework when detection found nothing and no framework was given', async () => {
    const { creator, created } = creatorUnderTest({ detectFails: new LaunchApiError(404, []) });

    const failure = await creator.create(request()).catch((error: unknown) => error);

    expect(failure).toEqual(new MissingInputError('framework', { config: false, prompt: true }));
    expect(created).toEqual([]);
  });

  it('propagates any other detection failure', async () => {
    const detectFails = new LaunchApiError(500, []);
    const { creator, created } = creatorUnderTest({ detectFails });

    await expect(creator.create(request({ framework: 'OTHER' }))).rejects.toBe(detectFails);
    expect(created).toEqual([]);
  });

  it('reports a failed first deployment as a partial success naming the surviving environment, exit 1', async () => {
    const { creator, calls, lines } = creatorUnderTest({ outcome: { kind: 'failure', status: 'FAILED' } });

    const failure = await creator.create(request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as DeploymentUnsuccessfulError).exitCode).toBe(1);
    expect((failure as Error).message).toBe(
      'The deployment did not succeed; its last status was FAILED. ' +
        'The environment "staging" (env9) was created and has not been rolled back. ' +
        'Run csdx launch:deployments:create --org org1 --project proj1 --env env9 to try the deployment again, ' +
        'or csdx launch:logs:get --org org1 --project proj1 --env env9 --deployment dep1 to see why it did not succeed.',
    );
    expect(lines).toContain('\u2714 Environment created successfully.');
    expect(calls.some((call) => call.startsWith('announce'))).toBe(false);
  });

  it('words a wait that ran out as possibly still finishing, naming deployments:get instead of a retry', async () => {
    const { creator } = creatorUnderTest({ outcome: { kind: 'timed-out', status: 'DEPLOYING' } });

    await expect(creator.create(request())).rejects.toThrow(
      new DeploymentUnsuccessfulError(
        'The deployment was still DEPLOYING when the CLI stopped waiting for it; it may still finish. ' +
          'The environment "staging" (env9) was created. Do not start another deployment yet: ' +
          'run csdx launch:deployments:get --org org1 --project proj1 --env env9 --deployment dep1 to see how it ends, ' +
          'or csdx launch:logs:get --org org1 --project proj1 --env env9 --deployment dep1 to follow it.',
      ),
    );
  });

  it('looks for the first deployment again, after the poll delay, when it is not listed yet', async () => {
    const { creator, calls, slept } = creatorUnderTest({ deploymentAfterLooks: 2 });

    await creator.create(request());

    expect(calls.filter((call) => call.startsWith('latest'))).toHaveLength(3);
    expect(slept).toEqual([250, 250]);
    expect(calls).toContain('watch {"org":"org1","project":"proj1","environment":"env9","deployment":"dep1"}');
  });

  it('reports a created environment with no deployment to follow after three looks, without naming a deployment', async () => {
    const { creator, calls, slept } = creatorUnderTest({ noDeployment: true });

    await expect(creator.create(request())).rejects.toThrow(
      new DeploymentUnsuccessfulError(
        'The deployment did not succeed; its last status was NONE. ' +
          'The environment "staging" (env9) was created and has not been rolled back. ' +
          'Run csdx launch:deployments:create --org org1 --project proj1 --env env9 to try the deployment again, ' +
          'or csdx launch:logs:get --org org1 --project proj1 --env env9 to see why it did not succeed.',
      ),
    );
    expect(calls.filter((call) => call.startsWith('latest'))).toHaveLength(3);
    expect(slept).toEqual([250, 250]);
  });

  it.each([
    [{ latestFails: new Error('lookup refused') }, ''],
    [{ watchFails: new Error('watch refused') }, ' --deployment dep1'],
  ])('words a failed step after the create the same partial-success way (%p)', async (fails, deployment) => {
    const { creator } = creatorUnderTest(fails);

    const failure = await creator.create(request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as Error).message).toMatch(/^The deployment could not be followed to completion: \w+ refused\. /);
    expect((failure as Error).message).toContain('The environment "staging" (env9) was created and has not been rolled back.');
    expect((failure as Error).message).toContain(`csdx launch:logs:get --org org1 --project proj1 --env env9${deployment} to see`);
  });

  it('propagates a refused create without saying the environment was created', async () => {
    const createFails = new LaunchApiError(409, [{ code: 'launch.ENVIRONMENT.DUPLICATE_NAME' }]);
    const { creator, lines, calls } = creatorUnderTest({ createFails });

    await expect(creator.create(request())).rejects.toBe(createFails);
    expect(lines).not.toContain('\u2714 Environment created successfully.');
    expect(calls[calls.length - 1]).toBe('create');
  });

  it('names the environment by the name it asked for when the create response carries none', async () => {
    const { creator } = creatorUnderTest({
      createdEnvironment: { uid: 'env9' },
      outcome: { kind: 'failure', status: 'FAILED' },
    });

    await expect(creator.create(request({ name: 'pre-release' }))).rejects.toThrow(
      'The environment "pre-release" (env9) was created and has not been rolled back.',
    );
  });
});
