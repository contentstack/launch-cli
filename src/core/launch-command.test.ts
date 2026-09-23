import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath, join } from 'node:path';

import { HttpClient, authHandler, configHandler } from '@contentstack/cli-utilities';

import { EXIT_RUNTIME, PROJECT_CONFIG_FILE } from './constants';
import * as projectConfigModule from './project-config';
import { getManageApiBaseUrl } from './region';
import { CancelledError, UsageError } from './errors';
import { MissingInputError } from './resolve';
import { exactlyOneOf } from './rules';
import { LaunchApiError } from '../transport/errors';
import { UxLike } from './render';
import { LaunchCommand, resolveLaunchContext } from './launch-command';

class Probe extends LaunchCommand {
  static flags = {};
  static inputs = {};

  async run(): Promise<void> {
    return undefined;
  }
}

class ProbeWithoutInputs extends LaunchCommand {
  static flags = {};

  async run(): Promise<void> {
    return undefined;
  }
}

class ProbeWithRules extends LaunchCommand {
  static flags = {};
  static inputs = { org: {}, limit: {} };
  static rules = [exactlyOneOf('org', 'limit')];

  async run(): Promise<void> {
    return undefined;
  }
}

class ProbeWithYes extends LaunchCommand {
  static flags = {};
  static inputs = { yes: {} };

  async run(): Promise<void> {
    return undefined;
  }
}

function probe(): Probe & { error: jest.Mock } {
  const instance = new Probe([], {} as never) as Probe & { error: jest.Mock };
  (instance as unknown as { error: unknown }).error = jest.fn();
  return instance;
}

function fakeHttpClient(onBaseUrl: (url: string) => void, onHeaders: (headers: Record<string, string>) => void = () => undefined) {
  const client: Record<string, unknown> = {};
  client.baseUrl = (url: string) => {
    onBaseUrl(url);
    return client;
  };
  client.interceptors = { response: { use: () => 0 } };
  client.asJson = () => client;
  client.headers = (headers: Record<string, string>) => {
    onHeaders(headers);
    return client;
  };
  client.queryParams = () => client;
  client.payload = () => client;
  client.send = async () => ({ status: 200, data: { projects: [], pagination: { count: 0, limit: 0, skip: 0 } } });
  return client as unknown as ReturnType<typeof HttpClient.create>;
}

describe('LaunchCommand.catch', () => {
  it('reports a missing input as a usage error', async () => {
    const instance = probe();

    await instance['catch'](new MissingInputError('org'));

    expect(instance.error).toHaveBeenCalledWith(expect.stringContaining('Missing required value for --org'), {
      exit: 2,
    });
  });

  it('reports a usage error as a usage error', async () => {
    const instance = probe();

    await instance['catch'](new UsageError('No project named "ghost" found in this organization.'));

    expect(instance.error).toHaveBeenCalledWith('No project named "ghost" found in this organization.', {
      exit: 2,
    });
  });

  it('reports a declined confirmation with the dedicated cancellation exit code', async () => {
    const instance = probe();

    await instance['catch'](new CancelledError());

    expect(instance.error).toHaveBeenCalledWith('Cancelled. Nothing was changed.', { exit: 3 });
  });

  it('reports an API failure as a runtime error', async () => {
    const instance = probe();

    await instance['catch'](new LaunchApiError(404, [{ code: 'launch.SOMETHING.ELSE', message: 'the api said no' }]));

    expect(instance.error).toHaveBeenCalledWith('the api said no', { exit: 1 });
  });

  it('delegates anything else to oclif, which sets process.exitCode before rethrowing', async () => {
    const instance = probe();
    const other = new Error('boom');
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    await expect(instance['catch'](other)).rejects.toThrow('boom');

    expect(instance.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = previousExitCode;
  });
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('LaunchCommand.confirm', () => {
  function gated(yes: boolean, isTTY: boolean, answer?: boolean) {
    const instance = new ProbeWithYes([], {} as never) as ProbeWithYes & { error: jest.Mock };
    (instance as unknown as { error: unknown }).error = jest.fn();
    const inquired: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        inquired.push(payload);
        return answer as never;
      },
    };
    (instance as unknown as { ux: UxLike }).ux = ux;
    (instance as unknown as { services: { ux: UxLike; isTTY: boolean } }).services = { ux, isTTY };
    (instance as unknown as { resolved: Record<string, unknown> }).resolved = { yes };
    return { instance, inquired };
  }

  it('throws a developer error when the command has not declared yes: {} in its static inputs', async () => {
    const instance = probe();
    (instance as unknown as { services: { ux: UxLike; isTTY: boolean } }).services = {
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    };
    (instance as unknown as { resolved: Record<string, unknown> }).resolved = {};

    await expect(instance['confirm']('Delete project "marketing-site"?')).rejects.toThrow(
      'Probe calls confirm() but does not declare yes: {} in its static inputs.',
    );
  });

  it('resolves without prompting when --yes was supplied, even with no TTY', async () => {
    const { instance, inquired } = gated(true, false);

    await expect(instance['confirm']('Delete project "marketing-site"?')).resolves.toBeUndefined();

    expect(inquired).toEqual([]);
    expect(instance.error).not.toHaveBeenCalled();
  });

  it('prompts on a TTY and resolves when the user accepts', async () => {
    const { instance, inquired } = gated(false, true, true);

    await expect(instance['confirm']('Delete project "marketing-site"?')).resolves.toBeUndefined();

    expect(inquired).toEqual([
      { type: 'confirm', name: 'confirm', message: 'Delete project "marketing-site"?', default: false },
    ]);
  });

  it('fails with the dedicated cancellation exit code when the user declines on a TTY', async () => {
    const { instance, inquired } = gated(false, true, false);

    const rejection = await instance['confirm']('Delete project "marketing-site"?').catch((err: Error) => err);
    await instance['catch'](rejection as Error);

    expect(rejection).toBeInstanceOf(CancelledError);
    expect(inquired).toHaveLength(1);
    expect(instance.error).toHaveBeenCalledWith('Cancelled. Nothing was changed.', { exit: 3 });
  });

  it('fails as a usage error without prompting when there is no TTY and no --yes', async () => {
    const { instance, inquired } = gated(false, false);

    const rejection = await instance['confirm']('Delete project "marketing-site"?').catch((err: Error) => err);
    await instance['catch'](rejection as Error);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(inquired).toEqual([]);
    expect(instance.error).toHaveBeenCalledWith(
      'Delete project "marketing-site"? Pass --yes to confirm without an interactive terminal.',
      { exit: 2 },
    );
  });

  it('does not accept a truthy non-boolean yes value as a confirmation', async () => {
    const { instance, inquired } = gated('true' as unknown as boolean, false);

    const rejection = await instance['confirm']('Delete project "marketing-site"?').catch((err: Error) => err);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(inquired).toEqual([]);
  });
});

describe('LaunchCommand.requireAuth', () => {
  it('does nothing when the user is authenticated', () => {
    const instance = probe();
    const spy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);

    instance['requireAuth']();

    expect(instance.error).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports a runtime error when the user is not authenticated', () => {
    const instance = probe();
    const spy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(false);

    instance['requireAuth']();

    expect(instance.error).toHaveBeenCalledWith('You are not logged in. Run csdx auth:login to continue.', {
      exit: EXIT_RUNTIME,
    });
    spy.mockRestore();
  });
});

describe('LaunchCommand.init', () => {
  it('never reaches the real authHandler/configHandler singletons that api calls in this suite fall through to', () => {
    expect(jest.isMockFunction(configHandler.get)).toBe(true);
    expect(jest.isMockFunction(authHandler.compareOAuthExpiry)).toBe(true);
  });

  it('parses using the declared flags and base flags, and wires the hub url into the built client', async () => {
    const instance = probe();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(instance, 'launchRegion', {
      value: { launchHubUrl: 'https://launch-api.test' },
      configurable: true,
    });
    Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' }, configurable: true });
    const parseMock = jest.fn().mockResolvedValue({ flags: {} });
    (instance as unknown as { parse: jest.Mock }).parse = parseMock;
    let capturedBaseUrl: string | undefined;
    const createSpy = jest.spyOn(HttpClient, 'create').mockReturnValue(fakeHttpClient((url) => {
      capturedBaseUrl = url;
    }));

    await instance.init();
    await instance['services'].api.projects.list({ org: 'org1' });

    expect(parseMock).toHaveBeenCalledWith({ flags: Probe.flags, baseFlags: LaunchCommand.baseFlags, strict: true });
    expect(capturedBaseUrl).toBe(getManageApiBaseUrl('https://launch-api.test'));
    expect(instance['services'].isTTY).toBe(true);
    expect(instance['services'].ux).toBe(instance['ux']);
    expect(instance['resolved']).toEqual({});

    createSpy.mockRestore();
    authSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('derives the hub url from the configured region cma when the region declares no launch hub url', async () => {
    const instance = probe();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    const regionSpy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'region') return { cma: 'api.contentstack.io' };
      return key === 'authorisationType' ? 'BASIC' : undefined;
    });
    Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' }, configurable: true });
    (instance as unknown as { parse: jest.Mock }).parse = jest.fn().mockResolvedValue({ flags: {} });
    let capturedBaseUrl: string | undefined;
    const createSpy = jest.spyOn(HttpClient, 'create').mockReturnValue(fakeHttpClient((url) => {
      capturedBaseUrl = url;
    }));

    await instance.init();
    await instance['services'].api.projects.list({ org: 'org1' });

    expect(capturedBaseUrl).toBe(getManageApiBaseUrl('https://launch-api.contentstack.com'));

    createSpy.mockRestore();
    regionSpy.mockRestore();
    authSpy.mockRestore();
  });

  it('fails with a usage error instead of a type error when no region is configured', async () => {
    const instance = probe();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' }, configurable: true });
    (instance as unknown as { parse: jest.Mock }).parse = jest.fn().mockResolvedValue({ flags: {} });

    await expect(instance.init()).rejects.toBeInstanceOf(UsageError);
    await expect(instance.init()).rejects.toThrow(
      'Region not configured. Please set the region with command $ csdx config:set:region',
    );

    authSpy.mockRestore();
  });

  it('resolves no inputs instead of throwing when the subclass declares no static inputs', async () => {
    const instance = new ProbeWithoutInputs([], {} as never) as ProbeWithoutInputs & { error: jest.Mock };
    (instance as unknown as { error: unknown }).error = jest.fn();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    Object.defineProperty(instance, 'launchRegion', {
      value: { launchHubUrl: 'https://launch-api.test' },
      configurable: true,
    });
    Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' }, configurable: true });
    (instance as unknown as { parse: jest.Mock }).parse = jest.fn().mockResolvedValue({ flags: {} });

    await instance.init();

    expect(instance['resolved']).toEqual({});
    authSpy.mockRestore();
  });
});

describe('LaunchCommand.init authentication gate', () => {
  it('stops at the auth check, never parsing flags or building the service context', async () => {
    const instance = new Probe([], {} as never) as Probe & { error: jest.Mock };
    const failure = new Error('You are not logged in. Run csdx auth:login to continue.');
    (instance as unknown as { error: unknown }).error = jest.fn(() => {
      throw failure;
    });
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(false);
    const parseMock = jest.fn().mockResolvedValue({ flags: {} });
    (instance as unknown as { parse: jest.Mock }).parse = parseMock;
    const createSpy = jest.spyOn(HttpClient, 'create');

    await expect(instance.init()).rejects.toBe(failure);

    expect(instance.error).toHaveBeenCalledWith('You are not logged in. Run csdx auth:login to continue.', {
      exit: EXIT_RUNTIME,
    });
    expect(parseMock).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(instance['services']).toBeUndefined();
    expect(instance['resolved']).toBeUndefined();

    createSpy.mockRestore();
    authSpy.mockRestore();
  });
});

describe('LaunchCommand.init terminal detection', () => {
  it.each([[false], [undefined]])('resolves isTTY to false when process.stdin.isTTY is %p', async (isTTY) => {
    const instance = probe();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true });
    Object.defineProperty(instance, 'launchRegion', {
      value: { launchHubUrl: 'https://launch-api.test' },
      configurable: true,
    });
    Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' }, configurable: true });
    (instance as unknown as { parse: jest.Mock }).parse = jest.fn().mockResolvedValue({ flags: {} });

    await instance.init();

    expect(instance['services'].isTTY).toBe(false);

    authSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('sends the oclif user agent as the analytics header on the requests the context makes', async () => {
    const instance = probe();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    Object.defineProperty(instance, 'launchRegion', {
      value: { launchHubUrl: 'https://launch-api.test' },
      configurable: true,
    });
    Object.defineProperty(instance, 'config', { value: { userAgent: 'csdx-cli/2.0.0 darwin-arm64' }, configurable: true });
    (instance as unknown as { parse: jest.Mock }).parse = jest.fn().mockResolvedValue({ flags: {} });
    let capturedHeaders: Record<string, string> | undefined;
    const createSpy = jest.spyOn(HttpClient, 'create').mockReturnValue(
      fakeHttpClient(
        () => undefined,
        (headers) => {
          capturedHeaders = headers;
        },
      ),
    );

    await instance.init();
    await instance['services'].api.projects.list({ org: 'org1' });

    expect(capturedHeaders?.['X-CS-CLI']).toBe('csdx-cli/2.0.0 darwin-arm64');

    createSpy.mockRestore();
    authSpy.mockRestore();
  });
});

describe('LaunchCommand.init rules', () => {
  it('evaluates the rules the subclass declares as a static rules array', async () => {
    const instance = new ProbeWithRules([], {} as never) as ProbeWithRules & { error: jest.Mock };
    (instance as unknown as { error: unknown }).error = jest.fn();
    const authSpy = jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
    Object.defineProperty(instance, 'launchRegion', {
      value: { launchHubUrl: 'https://launch-api.test' },
      configurable: true,
    });
    Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' }, configurable: true });
    (instance as unknown as { parse: jest.Mock }).parse = jest
      .fn()
      .mockResolvedValue({ flags: { org: 'org1', limit: 10 } });

    await expect(instance.init()).rejects.toThrow('Pass exactly one of --org, --limit; --org, --limit were supplied.');

    authSpy.mockRestore();
  });
});

describe('resolveLaunchContext rules', () => {
  it('passes the declared rules through to the resolver, which evaluates them', async () => {
    const promise = resolveLaunchContext({
      flags: { org: 'org1', limit: 10 },
      inputs: { org: {}, limit: {} },
      rules: [exactlyOneOf('org', 'limit')],
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });

    await expect(promise).rejects.toBeInstanceOf(UsageError);
    await expect(promise).rejects.toThrow('Pass exactly one of --org, --limit; --org, --limit were supplied.');
  });
});

describe('resolveLaunchContext', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    tempDirs.length = 0;
  });

  it('reads .cs-launch.json from the default data-dir/config path when neither flag is supplied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-cli-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, PROJECT_CONFIG_FILE), JSON.stringify({ project: { organizationUid: 'org-from-cwd' } }));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir);
    const readSpy = jest.spyOn(projectConfigModule, 'readProjectConfig');

    const result = await resolveLaunchContext({
      flags: {},
      inputs: { org: {} },
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });

    expect(readSpy).toHaveBeenCalledWith(resolvePath(dir, PROJECT_CONFIG_FILE));
    expect(result.resolved).toEqual({ org: 'org-from-cwd' });
    expect(result.services.isTTY).toBe(false);
    cwdSpy.mockRestore();
    readSpy.mockRestore();
  });

  it('reads the config file from the supplied data-dir using the default file name when no config flag is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-cli-'));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, PROJECT_CONFIG_FILE),
      JSON.stringify({ project: { organizationUid: 'org-from-data-dir' } }),
    );

    const result = await resolveLaunchContext({
      flags: { 'data-dir': dir },
      inputs: { org: {} },
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });

    expect(result.resolved).toEqual({ org: 'org-from-data-dir' });
  });

  it('reads the exact file named by the config flag, ignoring data-dir and the default file name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-cli-'));
    tempDirs.push(dir);
    const customPath = join(dir, 'custom.json');
    writeFileSync(customPath, JSON.stringify({ project: { organizationUid: 'org-from-custom-config' } }));
    const ux = { print: () => undefined, inquire: async () => undefined as never };

    const result = await resolveLaunchContext({
      flags: { 'data-dir': '/should/not/be/used', config: customPath },
      inputs: { org: {} },
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux,
      isTTY: true,
    });

    expect(result.resolved).toEqual({ org: 'org-from-custom-config' });
    expect(result.services.ux).toBe(ux);
    expect(result.services.isTTY).toBe(true);
  });
});
