import Rollback from './rollback';
import { Logger } from '../../util';
import { cliux } from '@contentstack/cli-utilities';

jest.mock('../../util', () => {
  const actual = jest.requireActual('../../util');
  return {
    ...actual,
    Logger: jest.fn(),
    selectOrg: jest.fn(),
    selectProject: jest.fn(),
  };
});

jest.mock('@contentstack/cli-utilities', () => {
  const actual = jest.requireActual('@contentstack/cli-utilities');
  return {
    ...actual,
    configHandler: {
      get: jest.fn((key) => {
        if (key === 'authtoken') return 'dummy-token';
        if (key === 'authorisationType') return 'OAuth';
        if (key === 'oauthAccessToken') return 'dummy-oauth-token';
        return undefined;
      }),
    },
    cliux: {
      ...actual.cliux,
      inquire: jest.fn(),
      print: jest.fn(),
    },
  };
});

const targetDeployment = {
  uid: 'target-uid',
  status: 'ARCHIVED',
  gitBranch: 'main',
  commitHash: 'abcdef1',
  createdAt: '2026-04-29T00:00:00Z',
  commitMessage: 'previous good build',
  deploymentUrl: 'https://example.com',
  deploymentNumber: 2,
  isRollbackEligible: true,
};

const liveDeployment = {
  ...targetDeployment,
  uid: 'live-uid',
  status: 'LIVE',
  deploymentNumber: 3,
};

const environmentsResponse = {
  data: {
    Environments: {
      edges: [
        {
          node: {
            uid: 'env-uid',
            name: 'Default',
            deployments: {
              edges: [
                { node: liveDeployment },
                { node: targetDeployment },
              ],
            },
          },
        },
      ],
    },
  },
};

const buildCommand = (flags: Record<string, any> = {}, queryImpl?: jest.Mock, mutateImpl?: jest.Mock) => {
  const cmd = new Rollback([], {} as any);
  (cmd as any).flags = flags;
  (cmd as any).log = jest.fn();
  (cmd as any).logger = { log: jest.fn() };
  (cmd as any).sharedConfig = { currentConfig: { uid: 'project-uid' } };
  (cmd as any).apolloClient = {
    query: queryImpl || jest.fn(),
    mutate: mutateImpl || jest.fn(),
  };
  return cmd;
};

describe('Rollback Command', () => {
  let exitMock: jest.SpyInstance;

  beforeEach(() => {
    (Logger as jest.Mock).mockImplementation(() => ({ log: jest.fn() }));
    exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('exits when no rollback-eligible deployments are available', async () => {
    const noEligibleResponse = {
      data: {
        Environments: {
          edges: [
            {
              node: {
                uid: 'env-uid',
                name: 'Default',
                deployments: { edges: [{ node: liveDeployment }] },
              },
            },
          ],
        },
      },
    };
    const query = jest.fn().mockResolvedValueOnce(noEligibleResponse);
    const mutate = jest.fn();
    const cmd = buildCommand({ environment: 'Default' }, query, mutate);
    jest
      .spyOn(cmd as any, 'fetchCurrentLiveDeployment')
      .mockResolvedValueOnce(liveDeployment);

    await expect((cmd as any).rollbackDeployment()).rejects.toThrow('process.exit:1');

    expect(mutate).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
    expect((cmd as any).log).toHaveBeenCalledWith(
      'No rollback-eligible deployments are available for this environment.',
      'error',
    );
  });

  it('exits when --deployment flag does not match an eligible deployment', async () => {
    const query = jest.fn().mockResolvedValueOnce(environmentsResponse);
    const mutate = jest.fn();
    const cmd = buildCommand(
      { environment: 'Default', deployment: 'unknown-uid' },
      query,
      mutate,
    );
    jest
      .spyOn(cmd as any, 'fetchCurrentLiveDeployment')
      .mockResolvedValueOnce(liveDeployment);

    await expect((cmd as any).rollbackDeployment()).rejects.toThrow('process.exit:1');

    expect(mutate).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
    expect((cmd as any).log).toHaveBeenCalledWith(
      'Provided deployment UID is not rollback-eligible or does not exist.',
      'error',
    );
  });

  it('skips the mutation when the user does not confirm', async () => {
    const query = jest.fn().mockResolvedValueOnce(environmentsResponse);
    const mutate = jest.fn();
    const cmd = buildCommand(
      { environment: 'Default', deployment: 'target-uid', reason: 'audit' },
      query,
      mutate,
    );
    jest
      .spyOn(cmd as any, 'fetchCurrentLiveDeployment')
      .mockResolvedValueOnce(liveDeployment);
    (cliux.inquire as jest.Mock).mockResolvedValueOnce(false); // confirm prompt

    await (cmd as any).rollbackDeployment();

    expect(mutate).not.toHaveBeenCalled();
  });

  it('fires the rollback mutation and polls until LIVE on success', async () => {
    const query = jest.fn().mockResolvedValueOnce(environmentsResponse);
    const mutate = jest.fn().mockResolvedValueOnce({
      data: { deployment: { ...targetDeployment, status: 'QUEUED' } },
    });
    const cmd = buildCommand(
      { environment: 'Default', deployment: 'target-uid', reason: 'restoring' },
      query,
      mutate,
    );
    jest
      .spyOn(cmd as any, 'fetchCurrentLiveDeployment')
      .mockResolvedValueOnce(liveDeployment);
    jest.spyOn(cmd as any, 'pollDeploymentStatus').mockResolvedValueOnce('LIVE');
    (cliux.inquire as jest.Mock).mockResolvedValueOnce(true);

    await (cmd as any).rollbackDeployment();

    expect(mutate).toHaveBeenCalledTimes(1);
    const variables = mutate.mock.calls[0][0].variables;
    expect(variables).toEqual({
      input: {
        deployment: 'target-uid',
        environment: 'env-uid',
        reason: 'restoring',
      },
    });
    expect((cmd as any).pollDeploymentStatus).toHaveBeenCalledWith('env-uid', 'target-uid');
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('logs an error and exits when the rollback mutation fails', async () => {
    const query = jest.fn().mockResolvedValueOnce(environmentsResponse);
    const error = Object.assign(new Error('boom'), {
      graphQLErrors: [{ extensions: { exception: { name: 'DeploymentRollbackFailed' } } }],
    });
    const mutate = jest.fn().mockRejectedValueOnce(error);
    const cmd = buildCommand(
      { environment: 'Default', deployment: 'target-uid' },
      query,
      mutate,
    );
    jest
      .spyOn(cmd as any, 'fetchCurrentLiveDeployment')
      .mockResolvedValueOnce(liveDeployment);
    (cliux.inquire as jest.Mock)
      .mockResolvedValueOnce('') // reason
      .mockResolvedValueOnce(true); // confirm

    await expect((cmd as any).rollbackDeployment()).rejects.toThrow('process.exit:1');

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect((cmd as any).log).toHaveBeenCalledWith(
      'Rollback failed. Please try again. (DeploymentRollbackFailed)',
      'error',
    );
  });
});
