import { randomUUID } from 'node:crypto';

import { HttpClient, authHandler, configHandler } from '@contentstack/cli-utilities';

import { SessionExpiredError, UnauthenticatedError } from './errors';
import { UxLike } from './render';
import { buildServiceContext } from './service-context';

interface CapturedCall {
  baseUrl?: string;
  headers?: Record<string, string>;
}

const UX: UxLike = { print: () => undefined, inquire: async () => undefined as never };

function basicSession(token = randomUUID()) {
  return jest
    .spyOn(configHandler, 'get')
    .mockImplementation((key: string) => (key === 'authorisationType' ? 'BASIC' : key === 'authtoken' ? token : undefined));
}

function capturingHttpClient(statuses: number[], captured: CapturedCall[]) {
  let index = 0;
  return jest.spyOn(HttpClient, 'create').mockImplementation(() => {
    const call: CapturedCall = {};
    captured.push(call);
    const client: Record<string, unknown> = {};
    client.baseUrl = (url: string) => {
      call.baseUrl = url;
      return client;
    };
    client.interceptors = { response: { use: () => 0 } };
    client.requestConfig = () => ({});
    client.asJson = () => client;
    client.headers = (headers: Record<string, string>) => {
      call.headers = headers;
      return client;
    };
    client.queryParams = () => client;
    client.payload = () => client;
    client.send = async () => ({
      status: statuses[Math.min(index++, statuses.length - 1)],
      data: { projects: [], pagination: { count: 0, limit: 0, skip: 0 } },
    });
    return client as unknown as ReturnType<typeof HttpClient.create>;
  });
}

function context() {
  return buildServiceContext({
    launchHubUrl: 'https://launch-api.test',
    analyticsInfo: 'cli/2.0.0',
    ux: UX,
    isTTY: false,
  });
}

describe('buildServiceContext', () => {
  it('wires an api surface onto a rest client built from the supplied base url', () => {
    const configSpy = basicSession();

    const built = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: UX,
      isTTY: true,
    });

    expect(typeof built.api.projects.list).toBe('function');
    expect(typeof built.api.projects.get).toBe('function');
    expect(built.ux).toBe(UX);
    expect(built.isTTY).toBe(true);
    configSpy.mockRestore();
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])('carries outputIsTTY %p through as %p, separately from isTTY', (outputIsTTY, expected) => {
    const configSpy = basicSession();

    const built = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: UX,
      isTTY: !expected,
      outputIsTTY,
    });

    expect(built.outputIsTTY).toBe(expected);
    expect(built.isTTY).toBe(!expected);
    configSpy.mockRestore();
  });

  it('carries isTTY: false through unchanged', () => {
    const configSpy = basicSession();

    expect(context().isTTY).toBe(false);
    configSpy.mockRestore();
  });

  it('refuses to build a context for a session with no authorisation type', () => {
    const configSpy = jest.spyOn(configHandler, 'get').mockImplementation(() => undefined);

    expect(() => context()).toThrow(UnauthenticatedError);
    configSpy.mockRestore();
  });
});

describe('buildServiceContext request wiring', () => {
  it('targets the manage base path under the launch hub url and sends the analytics info header', async () => {
    const captured: CapturedCall[] = [];
    const configSpy = basicSession();
    const httpSpy = capturingHttpClient([200], captured);

    await context().api.projects.list({ org: 'org1' });

    expect(captured[0].baseUrl).toBe('https://launch-api.test/manage');
    expect(captured[0].headers?.['X-CS-CLI']).toBe('cli/2.0.0');
    httpSpy.mockRestore();
    configSpy.mockRestore();
  });

  it('sends the authtoken and names the timed-out session on a BASIC session that gets a 401', async () => {
    const token = randomUUID();
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const configSpy = basicSession(token);
    const captured: CapturedCall[] = [];
    const httpSpy = capturingHttpClient([401], captured);

    const rejection = context().api.projects.list({ org: 'org1' });

    await expect(rejection).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(rejection).rejects.toThrow('Your session has timed out. Run csdx auth:login to continue.');
    expect(captured).toHaveLength(1);
    expect(captured[0].headers?.authtoken).toBe(token);
    expect(captured[0].headers?.authorization).toBeUndefined();
    expect(expirySpy).not.toHaveBeenCalled();
    httpSpy.mockRestore();
    configSpy.mockRestore();
    expirySpy.mockRestore();
  });

  it('propagates an oauth expiry check rejection instead of sending an unauthenticated request', async () => {
    const failure = new Error('oauth session expired');
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockRejectedValue(failure);
    const configSpy = jest
      .spyOn(configHandler, 'get')
      .mockImplementation((key: string) => (key === 'authorisationType' ? 'OAUTH' : undefined));
    const captured: CapturedCall[] = [];
    const httpSpy = capturingHttpClient([200], captured);

    await expect(context().api.projects.list({ org: 'org1' })).rejects.toBe(failure);

    expect(captured[0].headers).toBeUndefined();
    httpSpy.mockRestore();
    configSpy.mockRestore();
    expirySpy.mockRestore();
  });

  it('retries a 401 oauth request with the bearer token the forced refresh produced', async () => {
    const staleToken = randomUUID();
    const freshToken = randomUUID();
    let token = staleToken;
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockImplementation(async (forced?: boolean) => {
      if (forced) {
        token = freshToken;
      }
    });
    const configSpy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'authorisationType') return 'OAUTH';
      return key === 'oauthAccessToken' ? token : undefined;
    });
    const captured: CapturedCall[] = [];
    const httpSpy = capturingHttpClient([401, 200], captured);

    await context().api.projects.list({ org: 'org1' });

    expect(captured).toHaveLength(2);
    expect(captured[0].headers?.authorization).toBe(`Bearer ${staleToken}`);
    expect(captured[1].headers?.authorization).toBe(`Bearer ${freshToken}`);
    expect(expirySpy).toHaveBeenCalledWith(true);
    httpSpy.mockRestore();
    configSpy.mockRestore();
    expirySpy.mockRestore();
  });
});
