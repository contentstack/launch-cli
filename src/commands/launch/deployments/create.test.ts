import type { LaunchError } from '../../../core/errors';
import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { PICK_COMMIT } from '../../../deployments/deployment.inputs';
import { firstDeploymentFailureMessage } from '../../../deployments/deployment.presenter';
import DeploymentsCreate from './create';

const DATA_DIR = '/work/site';
const CONFIG_PATH = '/work/site/.cs-launch.json';

function commandUnderTest(resolved: Record<string, unknown>, projectType = 'GITPROVIDER') {
  const lines: string[] = [];
  const ux: UxLike = { print: (message: string) => lines.push(message), inquire: async () => undefined as never };
  const created: unknown[] = [];
  const command = Object.create(DeploymentsCreate.prototype) as DeploymentsCreate;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1', 'last-upload': false, ...resolved },
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    services: {
      ux,
      isTTY: false,
      outputIsTTY: false,
      api: {
        projects: { get: async () => ({ uid: 'proj1', projectType }) },
        deployments: {
          create: async (params: unknown) => {
            created.push(params);
            return { uid: 'd1', status: 'QUEUED' };
          },
          get: async () => ({ uid: 'd1', status: 'LIVE' }),
        },
        deploymentLogs: { after: async () => [] },
      },
    },
  });

  return { command, lines, created };
}

describe('launch:deployments:create', () => {
  it('declares org, project and env as required inputs and commit and last-upload as optional ones', () => {
    expect(DeploymentsCreate.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      commit: {},
      'last-upload': {},
    });
  });

  it('exposes exactly the flags it declares, beside the base flags', () => {
    expect(Object.keys(DeploymentsCreate.flags).sort()).toEqual(['commit', 'env', 'last-upload', 'org', 'project']);
    expect(Object.keys(DeploymentsCreate.baseFlags).sort()).toEqual(['config', 'data-dir']);
  });

  it('names flags the failure message of a first deployment sends the user to', () => {
    const message = firstDeploymentFailureMessage({
      created: 'x',
      plural: false,
      org: 'o',
      project: 'p',
      status: 'FAILED',
    });

    for (const flag of ['org', 'project']) {
      expect(message).toContain(`--${flag} `);
      expect(Object.keys(DeploymentsCreate.flags)).toContain(flag);
    }
  });

  it('sends a plain run to the branch tip of the resolved environment in the resolved scope', async () => {
    const { command, created } = commandUnderTest({});

    await command.run();

    expect(created).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
  });

  it('sends --commit as the commit hash', async () => {
    const { command, created } = commandUnderTest({ commit: 'abc123' });

    await command.run();

    expect(created).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', commitHash: 'abc123' }]);
  });

  it('refuses a bare --commit with exit 2 naming --commit <sha>, sending nothing and never deploying the branch tip', async () => {
    const { command, created } = commandUnderTest({ commit: PICK_COMMIT });

    const failure = await command.run().catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as LaunchError).exitCode).toBe(2);
    expect((failure as Error).message).toContain('--commit <sha>');
    expect(created).toEqual([]);
  });

  it('refuses --last-upload on a GitHub project and --commit on a FileUpload project without sending a create', async () => {
    const onGit = commandUnderTest({ 'last-upload': true });
    const onUpload = commandUnderTest({ commit: 'abc123' }, 'FILEUPLOAD');

    const gitFailure = await onGit.command.run().catch((error: Error) => error);
    const uploadFailure = await onUpload.command.run().catch((error: Error) => error);

    expect(gitFailure).toBeInstanceOf(UsageError);
    expect(uploadFailure).toBeInstanceOf(UsageError);
    expect(onGit.created).toEqual([]);
    expect(onUpload.created).toEqual([]);
  });

  it('redeploys the last bundle of a FileUpload project when --last-upload is given', async () => {
    const { command, created } = commandUnderTest({ 'last-upload': true }, 'FILEUPLOAD');

    await command.run();

    expect(created).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
  });
});
