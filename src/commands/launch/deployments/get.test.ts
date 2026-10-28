import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { LaunchApiError } from '../../../transport/errors';
import DeploymentsGet from './get';

function commandUnderTest(options: {
  resolved?: Record<string, unknown>;
  projectType?: string;
  deployment?: unknown;
  latest?: unknown;
  failures?: { project?: Error; get?: Error; latest?: Error };
}) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const calls: string[] = [];
  const projectCalls: unknown[] = [];
  const getCalls: unknown[] = [];
  const latestCalls: unknown[] = [];
  const command = Object.create(DeploymentsGet.prototype) as DeploymentsGet;

  Object.assign(command, {
    ux,
    resolved: options.resolved ?? { org: 'org1', project: 'proj1', env: 'env1' },
    services: {
      ux,
      isTTY: false,
      outputIsTTY: false,
      api: {
        projects: {
          get: async (params: unknown) => {
            calls.push('projects.get');
            projectCalls.push(params);

            if (options.failures?.project) {
              throw options.failures.project;
            }

            return { uid: 'proj1', projectType: options.projectType ?? 'GITPROVIDER' };
          },
        },
        deployments: {
          get: async (params: unknown) => {
            calls.push('deployments.get');
            getCalls.push(params);

            if (options.failures?.get) {
              throw options.failures.get;
            }

            return options.deployment;
          },
          latest: async (params: unknown) => {
            calls.push('deployments.latest');
            latestCalls.push(params);

            if (options.failures?.latest) {
              throw options.failures.latest;
            }

            return options.latest;
          },
        },
      },
    },
  });

  return { command, lines, calls, projectCalls, getCalls, latestCalls };
}

const DEPLOYMENT = {
  uid: 'd1',
  status: 'LIVE',
  gitBranch: 'main',
  commitHash: 'abcdef0123456789',
  commitMessage: 'Ship it',
  deploymentUrl: 'site.example.test',
  environmentVariables: [{ key: 'A', value: 'b' }],
};

function valueOf(lines: string[], field: string): string | undefined {
  const row = lines.find((line) => line.startsWith(`│  ${field} `));

  return row?.split('│')[2].trim();
}

describe('launch:deployments:get', () => {
  it('fetches the named deployment in the resolved environment and prints a FIELD | VALUE table', async () => {
    const { command, lines, getCalls, latestCalls, projectCalls } = commandUnderTest({
      resolved: { org: 'org1', project: 'proj1', env: 'env1', deployment: 'd1' },
      deployment: DEPLOYMENT,
    });

    await command.run();

    expect(projectCalls).toEqual([{ org: 'org1', project: 'proj1' }]);
    expect(getCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', deployment: 'd1' }]);
    expect(latestCalls).toEqual([]);
    expect(lines[1]).toContain('FIELD');
    expect(valueOf(lines, 'DEPLOYMENT UID')).toBe('d1');
    expect(valueOf(lines, 'STATUS')).toBe('LIVE');
    expect(valueOf(lines, 'BRANCH')).toBe('main');
    expect(valueOf(lines, 'COMMIT')).toBe('abcdef0123456789');
    expect(valueOf(lines, 'COMMIT MESSAGE')).toBe('Ship it');
    expect(valueOf(lines, 'URL')).toBe('https://site.example.test');
    expect(valueOf(lines, 'ENVIRONMENT VARIABLES')).toContain('1 (list them with');
    expect(lines.join('\n')).not.toContain('BUILD LOGS');
    expect(lines.join('\n')).not.toContain('launch:logs:get');
  });

  it('shows the latest deployment through the one-row lookup when --deployment is not given', async () => {
    const { command, lines, getCalls, latestCalls } = commandUnderTest({ latest: DEPLOYMENT });

    await command.run();

    expect(latestCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(getCalls).toEqual([]);
    expect(valueOf(lines, 'DEPLOYMENT UID')).toBe('d1');
  });

  it('exits 2 saying there are no deployments when the environment has none', async () => {
    const { command, lines } = commandUnderTest({ latest: undefined });

    const failure = await command.run().catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as Error).message).toBe('No deployments found in this environment.');
    expect(lines).toEqual([]);
  });

  it('turns a missing deployment into the generic wording, naming no other scope', async () => {
    const { command, lines } = commandUnderTest({
      resolved: { org: 'org1', project: 'proj1', env: 'env1', deployment: 'd404' },
      failures: { get: new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'nope' }]) },
    });

    const failure = await command.run().catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe('No deployment with UID "d404" found in this environment.');
    expect(lines).toEqual([]);
  });

  it('hides branch and commit rows for a file-upload project and keeps them for a git project', async () => {
    const fileUpload = commandUnderTest({ latest: DEPLOYMENT, projectType: 'FILEUPLOAD' });
    const git = commandUnderTest({ latest: DEPLOYMENT, projectType: 'GITPROVIDER' });

    await fileUpload.command.run();
    await git.command.run();

    expect(fileUpload.lines.join('\n')).not.toContain('BRANCH');
    expect(fileUpload.lines.join('\n')).not.toContain('COMMIT');
    expect(fileUpload.lines.join('\n')).not.toContain('Ship it');
    expect(valueOf(git.lines, 'BRANCH')).toBe('main');
    expect(valueOf(git.lines, 'COMMIT')).toBe('abcdef0123456789');
  });

  it.each([
    ['projects.get', { project: new LaunchApiError(500, []) }, { deployment: 'd1' }],
    ['deployments.get', { get: new LaunchApiError(500, []) }, { deployment: 'd1' }],
    ['deployments.latest', { latest: new LaunchApiError(500, []) }, {}],
  ])('propagates a %s failure as the same instance with exit 1 and prints nothing', async (_name, failures, extra) => {
    const { command, lines } = commandUnderTest({
      resolved: { org: 'org1', project: 'proj1', env: 'env1', ...extra },
      failures,
    });

    const failure = await command.run().catch((error: Error) => error);

    expect(failure).toBe(Object.values(failures)[0]);
    expect((failure as LaunchApiError).exitCode).toBe(1);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required and deployment as optional, and exactly those flags', () => {
    expect(DeploymentsGet.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      deployment: {},
    });
    expect(Object.keys(DeploymentsGet.flags).sort()).toEqual(['deployment', 'env', 'org', 'project']);
  });
});
