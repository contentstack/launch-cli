import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { cliux } from '@contentstack/cli-utilities';
import { mkdtempSync, writeFileSync } from 'fs';

import { selectOrg, selectProject, getOrganizations } from './util';

import { SecretsBaseCommand } from './base-secrets-command';
import ListSecrets from './commands/launch/secrets/list';
import SetSecret from './commands/launch/secrets/set';
import UnsetSecret from './commands/launch/secrets/unset';

jest.mock('./util', () => {
  const actual = jest.requireActual('./util');
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
    selectOrg: jest.fn(),
    selectProject: jest.fn(),
    getOrganizations: jest.fn(),
  };
});

jest.mock('@contentstack/cli-utilities', () => {
  const { launchCommand } = jest.requireActual('./test/mocks/cli-utilities');
  return launchCommand;
});

class Probe extends SecretsBaseCommand<typeof Probe> {
  async run(): Promise<void> {}
}

class UnexpectedArgsError extends Error {
  parse = {};
}

class NonExistentFlagsError extends Error {
  parse = {};
}

class FailedFlagValidationError extends Error {
  parse = {};
}

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor;

const stubStdin = (isTTY: boolean) => {
  const stream: any = Readable.from([]);
  stream.isTTY = isTTY;
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true });
};

const projectsResponse = (uids: string[]) => ({
  data: {
    projects: { edges: uids.map((uid) => ({ node: { uid, name: `name-${uid}` } })) },
  },
});

const writeConfig = (content: Record<string, any>) => {
  const path = join(mkdtempSync(join(tmpdir(), 'secrets-base-')), '.cs-launch.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
};

const buildProbe = (flags: Record<string, any> = {}, currentConfig: Record<string, any> = {}, extra: any = {}) => {
  const cmd = new Probe([], {} as any);
  const query = jest.fn().mockResolvedValue(projectsResponse(['P1', 'P2']));
  (cmd as any).flags = flags;
  (cmd as any).log = jest.fn();
  (cmd as any).sharedConfig = { currentConfig: { ...currentConfig }, ...extra };
  (cmd as any).apolloClient = { query };
  (cmd as any).managementSdk = {};
  jest.spyOn(cmd as any, 'prepareApiClients').mockResolvedValue(undefined);
  return { cmd: cmd as any, query };
};

describe('SecretsBaseCommand', () => {
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

  it('selects the organization and project again in a terminal when --org or --project override the stored project', async () => {
    stubStdin(true);
    const { cmd } = buildProbe({ org: 'O2', project: 'P2', environment: 'Default' }, { uid: 'P1' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await cmd.setupScope();

    expect(selectOrg).toHaveBeenCalledTimes(1);
    expect(selectProject).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored project without selecting in a terminal when no scope flag is given', async () => {
    stubStdin(true);
    const { cmd } = buildProbe({ environment: 'Default' }, { uid: 'P1' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await cmd.setupScope();

    expect(selectOrg).not.toHaveBeenCalled();
    expect(selectProject).not.toHaveBeenCalled();
  });

  it('overrides the stored project with --project and --org when not in a terminal', async () => {
    stubStdin(false);
    (getOrganizations as jest.Mock).mockResolvedValue([{ uid: 'O1' }, { uid: 'O2' }]);
    const { cmd, query } = buildProbe({ org: 'O2', project: 'P2', environment: 'Default' }, { uid: 'P1', organizationUid: 'O1' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await cmd.setupScope();

    expect(cmd.sharedConfig.currentConfig).toEqual(expect.objectContaining({ uid: 'P2', organizationUid: 'O2' }));
    expect(query).toHaveBeenCalledTimes(1);
    expect(cmd.prepareApiClients).toHaveBeenCalledTimes(3);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(selectOrg).not.toHaveBeenCalled();
    expect(selectProject).not.toHaveBeenCalled();
  });

  it('keeps the stored project without any lookup when not in a terminal and no scope flag is given', async () => {
    stubStdin(false);
    const { cmd, query } = buildProbe({ environment: 'Default' }, { uid: 'P1', organizationUid: 'O1' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await cmd.setupScope();

    expect(cmd.sharedConfig.currentConfig.uid).toBe('P1');
    expect(query).not.toHaveBeenCalled();
    expect(getOrganizations).not.toHaveBeenCalled();
  });

  it('fails without prompting when not in a terminal and --org does not match an organization', async () => {
    stubStdin(false);
    (getOrganizations as jest.Mock).mockResolvedValue([{ uid: 'O1' }]);
    const { cmd } = buildProbe({ org: 'WRONG', project: 'P1', environment: 'Default' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await expect(cmd.setupScope()).rejects.toThrow('process.exit:1');

    expect(cmd.log).toHaveBeenCalledWith('Organization UID not found!', 'error');
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('fails without prompting when not in a terminal and --project does not match a project', async () => {
    stubStdin(false);
    (getOrganizations as jest.Mock).mockResolvedValue([{ uid: 'O1' }]);
    const { cmd } = buildProbe({ org: 'O1', project: 'WRONG', environment: 'Default' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await expect(cmd.setupScope()).rejects.toThrow('process.exit:1');

    expect(cmd.log).toHaveBeenCalledWith('Project not found!', 'error');
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('fails before loading the config when not in a terminal and --environment is missing', async () => {
    stubStdin(false);
    const { cmd } = buildProbe({ org: 'O1', project: 'P1' });
    const getConfig = jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await expect(cmd.setupScope()).rejects.toThrow('process.exit:1');

    expect(cmd.log).toHaveBeenCalledWith(expect.stringContaining('--org, --project and --environment are required'), 'error');
    expect(getConfig).not.toHaveBeenCalled();
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('fails without prompting when not in a terminal and no project is stored or given', async () => {
    stubStdin(false);
    const { cmd } = buildProbe({ environment: 'Default' });
    jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await expect(cmd.setupScope()).rejects.toThrow('process.exit:1');

    expect(cmd.log).toHaveBeenCalledWith(expect.stringContaining('--org, --project and --environment are required'), 'error');
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('loads the config non-interactively when not in a terminal', async () => {
    stubStdin(false);
    const { cmd } = buildProbe({ environment: 'Default' }, { uid: 'P1' });
    const getConfig = jest.spyOn(cmd, 'getConfig').mockResolvedValue(undefined);

    await cmd.setupScope();

    expect(getConfig).toHaveBeenCalledWith({ interactive: false });
  });

  it('fails without prompting when a branch must be chosen and the config is loaded non-interactively', async () => {
    const config = writeConfig({ main: { uid: 'P1' }, develop: { uid: 'P1' } });
    const { cmd } = buildProbe({}, {}, { config });

    await expect(cmd.getConfig({ interactive: false })).rejects.toThrow('process.exit:1');

    expect(cmd.log).toHaveBeenCalledWith('Multiple branches are configured; pass --branch to choose one.', 'error');
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('uses the branch given with --branch without prompting when the config is loaded non-interactively', async () => {
    const config = writeConfig({ main: { uid: 'P1' }, develop: { uid: 'P2' } });
    const { cmd } = buildProbe({ branch: 'develop' }, {}, { config, providerMapper: {} });

    await cmd.getConfig({ interactive: false });

    expect(cmd.sharedConfig.currentConfig.uid).toBe('P2');
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('still prompts for the branch by default', async () => {
    const config = writeConfig({ main: { uid: 'P1' }, develop: { uid: 'P2' } });
    (cliux.inquire as jest.Mock).mockResolvedValueOnce('develop');
    const { cmd } = buildProbe({}, {}, { config, providerMapper: {} });

    await cmd.getConfig();

    expect(cmd.sharedConfig.currentConfig.uid).toBe('P2');
    expect((cliux.inquire as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'branch' }));
  });

  it('fails without prompting when not in a terminal and no environment is given to resolveEnvironment', async () => {
    stubStdin(false);
    const { cmd, query } = buildProbe({});
    query.mockResolvedValue({ data: { Environments: { edges: [] } } });

    await expect(cmd.resolveEnvironment()).rejects.toThrow('process.exit:1');

    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('shows read-context wording when the environments query fails with 404', async () => {
    stubStdin(true);
    const { cmd, query } = buildProbe({ environment: 'Default' });
    query.mockRejectedValue({ message: 'x', graphQLErrors: [{ message: 'x', extensions: { exception: { status: 404 } } }] });

    await expect(cmd.resolveEnvironment()).rejects.toThrow('process.exit:1');

    expect(cmd.log).toHaveBeenCalledWith('The project or environment was not found.', 'error');
  });

  it.each([
    ['unexpected argument', new UnexpectedArgsError('Unexpected argument: SECRETVALUE')],
    ['short flag glued to a value', new NonExistentFlagsError('Nonexistent flag: -vSECRETVALUE')],
  ])('replaces the message of a parse error with a generic one for a %s', async (_label, error) => {
    const value = randomUUID();
    error.message = error.message.replace('SECRETVALUE', value);
    error.stack = `${error.message}\n    at parse`;
    const { cmd } = buildProbe();

    await expect(cmd.catch(error)).rejects.toThrow(/Invalid arguments/);

    expect(error.message).not.toContain(value);
    expect(error.stack).not.toContain(value);
  });

  it('keeps the message of a missing required flag error', async () => {
    const error = new FailedFlagValidationError('Missing required flag key');
    const { cmd } = buildProbe();

    await expect(cmd.catch(error)).rejects.toThrow('Missing required flag key');
  });

  it.each([
    ['list', ListSecrets],
    ['set', SetSecret],
    ['unset', UnsetSecret],
  ])('declares the hidden --branch flag and the shared scope flags on %s', (_name, command) => {
    const flags = command.flags as Record<string, any>;

    expect(flags.branch.hidden).toBe(true);
    expect(Object.keys(flags)).toEqual(expect.arrayContaining(['org', 'project', 'environment', 'branch']));
  });
});
