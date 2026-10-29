import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { mkdtempSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { cliux } from '@contentstack/cli-utilities';

import { addEnvironmentSecretMutation, refreshEnvironmentSecretMutation } from '../../../graphql';

import { Logger } from '../../../util';

import SetSecret from './set';

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

const environmentsResponse = (secrets: Record<string, any>[] = [], name = 'Default') => ({
  data: { Environments: { edges: [{ node: { uid: ENVIRONMENT_UID, name, secrets } }] } },
});

const SECRET_CODES = {
  conflict: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.CONFLICT',
  multiline: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.VALUE.MULTILINE',
};

const apiError = (status: number) => ({
  message: 'Request failed',
  graphQLErrors: [{ message: 'Request failed', extensions: { exception: { status } } }],
});

const formError = (code: string) => ({
  message: 'Bad request',
  graphQLErrors: [
    {
      message: 'Bad request',
      extensions: { exception: { status: 400, messages: [code], errorObject: { secret: [{ code }] } } },
    },
  ],
});

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor;

const stubStdin = (isTTY: boolean, chunks: string[] = []) => {
  const stream: any = Readable.from(chunks);
  stream.isTTY = isTTY;
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true });
};

const buildCommand = (
  flags: Record<string, any>,
  { secrets = [], mutate = jest.fn().mockResolvedValue({ data: {} }) }: { secrets?: Record<string, any>[]; mutate?: jest.Mock } = {},
) => {
  const query = jest.fn().mockResolvedValue(environmentsResponse(secrets));
  const cmd = new SetSecret([], {} as any);
  (cmd as any).flags = { environment: 'Default', key: 'API_TOKEN', yes: false, ...flags };
  (cmd as any).log = jest.fn();
  (cmd as any).sharedConfig = { currentConfig: { uid: 'project-uid' } };
  (cmd as any).apolloClient = { query, mutate };
  return { cmd, query, mutate };
};

const allOutput = (...mocks: jest.Mock[]) => JSON.stringify(mocks.map((mock) => mock.mock.calls));

describe('SetSecret Command', () => {
  let exitMock: jest.SpyInstance;

  beforeEach(() => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as any);
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', originalStdin);
    jest.clearAllMocks();
  });

  it('adds the secret with the value piped on stdin without prompting when --yes is passed', async () => {
    const value = randomUUID();
    stubStdin(false, [`${value}\n`]);
    const { cmd, mutate } = buildCommand({ yes: true });

    await (cmd as any).setSecret();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      mutation: addEnvironmentSecretMutation,
      variables: { environment: { uid: ENVIRONMENT_UID }, secret: { key: 'API_TOKEN', value } },
    });
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('strips only one trailing CRLF from the piped value', async () => {
    const value = randomUUID();
    stubStdin(false, [`${value}\n`, '\r\n']);
    const { cmd, mutate } = buildCommand({ yes: true });

    await (cmd as any).setSecret();

    expect(mutate.mock.calls[0][0].variables.secret.value).toBe(`${value}\n`);
  });

  it('asks for the value with a masked prompt then confirms before adding when run in a terminal', async () => {
    const value = randomUUID();
    stubStdin(true);
    (cliux.inquire as jest.Mock).mockResolvedValueOnce(value).mockResolvedValueOnce(true);
    const { cmd, mutate } = buildCommand({});

    await (cmd as any).setSecret();

    const [first, second] = (cliux.inquire as jest.Mock).mock.calls.map(([question]) => question);
    expect(first.type).toBe('password');
    expect(second.type).toBe('confirm');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].variables.secret).toEqual({ key: 'API_TOKEN', value });
  });

  it('refreshes the secret instead of adding it when the key already exists', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand(
      { yes: true },
      { secrets: [{ key: 'API_TOKEN', updatedAt: '2026-01-01T00:00:00.000Z' }] },
    );

    await (cmd as any).setSecret();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].mutation).toBe(refreshEnvironmentSecretMutation);
    expect(mutate.mock.calls[0][0].variables.environment).toEqual({ uid: ENVIRONMENT_UID });
  });

  it('aborts without a mutation or an error exit when the confirmation is declined', async () => {
    stubStdin(true);
    (cliux.inquire as jest.Mock).mockResolvedValueOnce(randomUUID()).mockResolvedValueOnce(false);
    const { cmd, mutate } = buildCommand({});

    await (cmd as any).setSecret();

    expect(mutate).not.toHaveBeenCalled();
    expect(cliux.print).toHaveBeenCalledWith(expect.stringContaining('Aborted'));
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('fails with a clear error and no mutation when nothing is piped on stdin', async () => {
    stubStdin(false, []);
    const { cmd, mutate } = buildCommand({ yes: true });

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect(mutate).not.toHaveBeenCalled();
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('no value received on stdin'), 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('fails with a clear error and no mutation when the prompted value is empty', async () => {
    stubStdin(true);
    (cliux.inquire as jest.Mock).mockResolvedValueOnce('');
    const { cmd, mutate } = buildCommand({});

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect(mutate).not.toHaveBeenCalled();
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('value cannot be empty'), 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('requires --yes when the value is piped and never prompts for confirmation', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand({ yes: false });

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect(mutate).not.toHaveBeenCalled();
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('use --yes when piping the value'), 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('warns for a client-exposed key and still sends the mutation', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand({ yes: true, key: 'NEXT_PUBLIC_API_URL' });

    await (cmd as any).setSecret();

    expect(cliux.print).toHaveBeenCalledWith(
      expect.stringContaining('NEXT_PUBLIC_API_URL'),
      expect.objectContaining({ color: 'yellow' }),
    );
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it.each(['API_TOKEN', 'MY_NEXT_PUBLIC_X'])('does not warn for the key %s', async (key) => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand({ yes: true, key });

    await (cmd as any).setSecret();

    expect(cliux.print).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('shows the multi-line message and leaks no value fragment when the API rejects a multi-line value', async () => {
    stubStdin(false, ['line1\nline2']);
    const mutate = jest.fn().mockRejectedValue(formError(SECRET_CODES.multiline));
    const { cmd } = buildCommand({ yes: true }, { mutate });

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('multi-line values are not supported'), 'error');
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(allOutput((cmd as any).log, cliux.print as jest.Mock)).not.toContain('line1');
  });

  it('reports the key conflict message when the API reports a key conflict', async () => {
    stubStdin(false, [randomUUID()]);
    const mutate = jest.fn().mockRejectedValue(formError(SECRET_CODES.conflict));
    const { cmd } = buildCommand({ yes: true }, { mutate });

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('already used by a variable or secret'), 'error');
  });

  it('prints a success line naming the key and never the value', async () => {
    const value = randomUUID();
    stubStdin(false, [value]);
    const { cmd } = buildCommand({ yes: true });

    await (cmd as any).setSecret();

    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('API_TOKEN'));
    expect(allOutput((cmd as any).log, cliux.print as jest.Mock)).not.toContain(value);
  });

  it('exits with an error when the environment is not found', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand({ yes: true, environment: 'Staging' });

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith('Environment(s) not found!', 'error');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('asks which environment to use when --environment is not given', async () => {
    stubStdin(true);
    (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default').mockResolvedValueOnce(randomUUID());
    const { cmd, mutate } = buildCommand({ yes: true, environment: undefined });

    await (cmd as any).setSecret();

    expect((cliux.inquire as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: 'search-list', name: 'Environment' }),
    );
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('reads the piped value before any prompt and keeps it for the mutation', async () => {
    const value = randomUUID();
    stubStdin(false, [`${value}\n`]);
    const { cmd, mutate } = buildCommand({ yes: true });

    await (cmd as any).preparePipedInput();
    await (cmd as any).setSecret();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].variables.secret.value).toBe(value);
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('fails without prompting or mutating when the value is piped and --environment is missing', async () => {
    const value = randomUUID();
    stubStdin(false, [value]);
    const { cmd, query, mutate } = buildCommand({ yes: true, environment: undefined });

    await expect((cmd as any).preparePipedInput()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(
      '--org, --project and --environment are required when the value is piped',
      'error',
    );
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(allOutput((cmd as any).log, cliux.inquire as jest.Mock)).not.toContain(value);
  });

  it('fails without prompting when the value is piped and no project is configured or given', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand({ yes: true, org: undefined, project: undefined });
    (cmd as any).sharedConfig = { currentConfig: {} };

    await expect((cmd as any).assertPipedScope()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(
      '--org, --project and --environment are required when the value is piped',
      'error',
    );
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not require --org and --project when a project is already configured', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd } = buildCommand({ yes: true });

    await expect((cmd as any).assertPipedScope()).resolves.toBeUndefined();

    expect(exitMock).not.toHaveBeenCalled();
  });

  it('reads the piped value before the config is loaded so no prompt can consume it', async () => {
    stubStdin(false, [randomUUID()]);
    (Logger as unknown as jest.Mock).mockImplementation(() => ({ log: jest.fn() }));
    const { cmd } = buildCommand({ yes: true });
    const getConfig = jest.spyOn(cmd as any, 'getConfig').mockResolvedValue(undefined);
    jest.spyOn(cmd as any, 'prepareApiClients').mockResolvedValue(undefined);
    const readStdin = jest.spyOn(cmd as any, 'readStdin');
    jest.spyOn(cmd as any, 'setSecret').mockResolvedValue(undefined);

    await cmd.run();

    expect(readStdin).toHaveBeenCalledTimes(1);
    expect(readStdin.mock.invocationCallOrder[0]).toBeLessThan(getConfig.mock.invocationCallOrder[0]);
  });

  it('fails without prompting or reading stdin when the value is piped and a branch would have to be chosen', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, mutate } = buildCommand({ yes: true });
    const dir = mkdtempSync(join(tmpdir(), 'secrets-branch-'));
    const configPath = join(dir, '.cs-launch.json');
    writeFileSync(configPath, JSON.stringify({ main: { uid: 'a' }, develop: { uid: 'b' } }));
    (cmd as any).sharedConfig = { config: configPath, currentConfig: {} };
    const readStdin = jest.spyOn(cmd as any, 'readStdin');

    await expect((cmd as any).preparePipedInput()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(
      'Multiple branches are configured; pass --branch when the value is piped',
      'error',
    );
    expect(readStdin).not.toHaveBeenCalled();
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not refuse a piped value when --branch names a configured branch', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd } = buildCommand({ yes: true, branch: 'main' });
    const dir = mkdtempSync(join(tmpdir(), 'secrets-branch-'));
    const configPath = join(dir, '.cs-launch.json');
    writeFileSync(configPath, JSON.stringify({ main: { uid: 'a' }, develop: { uid: 'b' } }));
    (cmd as any).sharedConfig = { config: configPath, currentConfig: {} };

    await expect((cmd as any).preparePipedInput()).resolves.toBeUndefined();

    expect(exitMock).not.toHaveBeenCalled();
  });

  it('shows a formatted error when reading the environment secrets fails', async () => {
    stubStdin(false, [randomUUID()]);
    const { cmd, query, mutate } = buildCommand({ yes: true });
    query.mockRejectedValue(apiError(403));

    await expect((cmd as any).setSecret()).rejects.toThrow('process.exit:1');

    expect((cmd as any).log).toHaveBeenCalledWith(expect.stringContaining('do not have permission'), 'error');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('redacts a flag value from a parse error before rethrowing it', async () => {
    const value = randomUUID();
    const { cmd } = buildCommand({});
    const error = new Error(`Nonexistent flag: --value=${value}`);

    await expect((cmd as any).catch(error)).rejects.toThrow('Nonexistent flag: --value');

    expect(error.message).not.toContain(value);
    expect(error.stack).not.toContain(value);
  });
});
