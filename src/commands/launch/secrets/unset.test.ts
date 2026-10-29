import { cliux } from '@contentstack/cli-utilities';

import { deleteEnvironmentSecretMutation } from '../../../graphql';

import UnsetSecret from './unset';

jest.mock('../../../util', () => {
  const actual = jest.requireActual('../../../util');
  return {
    ...actual,
    Logger: jest.fn(),
    selectOrg: jest.fn(),
    selectProject: jest.fn(),
  };
});

jest.mock('@contentstack/cli-utilities', () => {
  const { launchCommand } = jest.requireActual('../../../test/mocks/cli-utilities');
  return { ...launchCommand, cliux: { ...launchCommand.cliux, table: jest.fn() } };
});

const ENVIRONMENT_UID = 'env-uid';

const environmentsResponse = (name = 'Default') => ({
  data: { Environments: { edges: [{ node: { uid: ENVIRONMENT_UID, name, secrets: [] } }] } },
});

const apiError = (status: number, name?: string) => ({
  message: 'Request failed',
  graphQLErrors: [{ message: 'Request failed', extensions: { exception: { status, ...(name ? { name } : {}) } } }],
});

const buildCommand = (
  flags: Record<string, any>,
  mutate: jest.Mock = jest.fn().mockResolvedValue({ data: { deleteEnvironmentSecret: true } }),
) => {
  const query = jest.fn().mockResolvedValue(environmentsResponse());
  const cmd = new UnsetSecret([], {} as any);
  (cmd as any).flags = { environment: 'Default', key: ['API_TOKEN'], yes: false, ...flags };
  (cmd as any).log = jest.fn();
  (cmd as any).sharedConfig = { currentConfig: { uid: 'project-uid' } };
  (cmd as any).apolloClient = { query, mutate };
  return { cmd, query, mutate };
};

describe('UnsetSecret Command', () => {
  let exitMock: jest.SpyInstance;

  beforeEach(() => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deletes every given key in order without prompting when --yes is passed', async () => {
    const { cmd, mutate } = buildCommand({ key: ['API_TOKEN', 'DB_PASSWORD'], yes: true });

    await (cmd as any).unsetSecrets();

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenNthCalledWith(1, {
      mutation: deleteEnvironmentSecretMutation,
      variables: { environmentUid: ENVIRONMENT_UID, key: 'API_TOKEN' },
    });
    expect(mutate).toHaveBeenNthCalledWith(2, {
      mutation: deleteEnvironmentSecretMutation,
      variables: { environmentUid: ENVIRONMENT_UID, key: 'DB_PASSWORD' },
    });
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('API_TOKEN'));
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('DB_PASSWORD'));
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('asks for confirmation and deletes the key when it is accepted', async () => {
    (cliux.inquire as jest.Mock).mockResolvedValueOnce(true);
    const { cmd, mutate } = buildCommand({});

    await (cmd as any).unsetSecrets();

    const [question] = (cliux.inquire as jest.Mock).mock.calls[0];
    expect(question.type).toBe('confirm');
    expect(question.message).toContain('API_TOKEN');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].variables).toEqual({ environmentUid: ENVIRONMENT_UID, key: 'API_TOKEN' });
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('aborts without a mutation or an error exit when the confirmation is declined', async () => {
    (cliux.inquire as jest.Mock).mockResolvedValueOnce(false);
    const { cmd, mutate } = buildCommand({ key: ['API_TOKEN', 'DB_PASSWORD'] });

    await (cmd as any).unsetSecrets();

    expect(mutate).not.toHaveBeenCalled();
    expect(cliux.print).toHaveBeenCalledWith(expect.stringContaining('Aborted'));
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('shows the permission message and exits 1 when the API answers 403', async () => {
    const { cmd } = buildCommand({ yes: true }, jest.fn().mockRejectedValue(apiError(403)));

    await expect((cmd as any).unsetSecrets()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('permission'), 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('keeps deleting the remaining keys after one fails and exits 1 at the end', async () => {
    const mutate = jest
      .fn()
      .mockRejectedValueOnce(apiError(404, 'ENVIRONMENT_SECRET_NOT_FOUND'))
      .mockResolvedValueOnce({ data: { deleteEnvironmentSecret: true } });
    const { cmd } = buildCommand({ key: ['MISSING_KEY', 'API_TOKEN'], yes: true }, mutate);

    await expect((cmd as any).unsetSecrets()).rejects.toThrow('process.exit:1');

    expect(mutate).toHaveBeenCalledTimes(2);
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('MISSING_KEY'), 'error');
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('API_TOKEN'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
