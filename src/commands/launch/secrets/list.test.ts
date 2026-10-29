import { print } from 'graphql';
import { randomUUID } from 'crypto';
import { cliux } from '@contentstack/cli-utilities';

import { environmentSecretsQuery } from '../../../graphql';

import ListSecrets from './list';

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

const secretsResponse = (secrets: Record<string, any>[], name = 'Default') => ({
  data: {
    Environments: {
      edges: [{ node: { uid: 'env-uid', name, secrets } }],
    },
  },
});

const buildCommand = (flags: Record<string, any>, query: jest.Mock) => {
  const cmd = new ListSecrets([], {} as any);
  (cmd as any).flags = flags;
  (cmd as any).log = jest.fn();
  (cmd as any).sharedConfig = { currentConfig: { uid: 'project-uid' } };
  (cmd as any).apolloClient = { query };
  return cmd;
};

describe('ListSecrets Command', () => {
  let exitMock: jest.SpyInstance;

  beforeEach(() => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders a table with KEY and UPDATED columns for the environment secrets', async () => {
    const query = jest.fn().mockResolvedValue(
      secretsResponse([
        { key: 'API_TOKEN', updatedAt: '2026-01-01T00:00:00.000Z' },
        { key: 'DB_PASSWORD', updatedAt: '2026-02-01T00:00:00.000Z' },
      ]),
    );
    const cmd = buildCommand({ environment: 'Default' }, query);

    await (cmd as any).listSecrets();

    expect(cliux.table).toHaveBeenCalledTimes(1);
    expect(cliux.table).toHaveBeenCalledWith(
      [{ value: 'KEY' }, { value: 'UPDATED' }],
      [
        { KEY: 'API_TOKEN', UPDATED: '2026-01-01T00:00:00.000Z' },
        { KEY: 'DB_PASSWORD', UPDATED: '2026-02-01T00:00:00.000Z' },
      ],
    );
  });

  it('selects only key and updatedAt of the secrets and never a value field', () => {
    const printed = print(environmentSecretsQuery);

    expect(printed).toMatch(/secrets\s*\{\s*key\s*updatedAt\s*\}/);
    expect(printed).not.toMatch(/\bvalue\b/);
  });

  it('exits with an error and renders no table when the environment is not found', async () => {
    const query = jest.fn().mockResolvedValue(secretsResponse([{ key: 'API_TOKEN', updatedAt: '2026-01-01T00:00:00.000Z' }]));
    const cmd = buildCommand({ environment: 'Staging' }, query);

    await expect((cmd as any).listSecrets()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith('Environment(s) not found!', 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(cliux.table).not.toHaveBeenCalled();
  });

  it.each([[404], [400]])('shows the server message and exits 1 when the secrets query fails with %i', async (status) => {
    const raw = randomUUID();
    const query = jest.fn().mockRejectedValue({
      message: raw,
      graphQLErrors: [{ message: raw, extensions: { exception: { status } } }],
    });
    const cmd = buildCommand({ environment: 'Default' }, query);

    await expect((cmd as any).listSecrets()).rejects.toThrow('process.exit:1');

    const expected = status === 400 ? 'invalid key or value' : raw;
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining(expected), 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(cliux.table).not.toHaveBeenCalled();
  });

  it('prints an empty-state line without exiting or rendering a table when there are no secrets', async () => {
    const query = jest.fn().mockResolvedValue(secretsResponse([]));
    const cmd = buildCommand({ environment: 'Default' }, query);

    await (cmd as any).listSecrets();

    expect(cliux.print).toHaveBeenCalledWith('No secrets found for environment Default.');
    expect(cliux.table).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
    expect((cmd as any).log).not.toHaveBeenCalled();
  });

  it('never outputs a value even when the response node carries one', async () => {
    const leakedValue = randomUUID();
    const query = jest
      .fn()
      .mockResolvedValue(secretsResponse([{ key: 'API_TOKEN', updatedAt: '2026-01-01T00:00:00.000Z', value: leakedValue }]));
    const cmd = buildCommand({ environment: 'Default' }, query);

    await (cmd as any).listSecrets();

    const everythingEmitted = JSON.stringify([
      (cliux.table as jest.Mock).mock.calls,
      (cliux.print as jest.Mock).mock.calls,
      (cmd as any).log.mock.calls,
    ]);
    expect(cliux.table).toHaveBeenCalledTimes(1);
    expect(everythingEmitted).not.toContain(leakedValue);
    expect((cliux.table as jest.Mock).mock.calls[0][1]).toEqual([
      { KEY: 'API_TOKEN', UPDATED: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('prompts for the environment when --environment is not given', async () => {
    const query = jest.fn().mockResolvedValue(secretsResponse([{ key: 'API_TOKEN', updatedAt: '2026-01-01T00:00:00.000Z' }]));
    (cliux.inquire as jest.Mock).mockResolvedValue('Default');
    const cmd = buildCommand({}, query);

    await (cmd as any).listSecrets();

    expect(cliux.inquire).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'search-list', name: 'Environment', message: 'Choose an environment' }),
    );
    expect(cliux.table).toHaveBeenCalledWith(
      [{ value: 'KEY' }, { value: 'UPDATED' }],
      [{ KEY: 'API_TOKEN', UPDATED: '2026-01-01T00:00:00.000Z' }],
    );
  });
});
