import { randomUUID } from 'node:crypto';

import { HttpClient, authHandler, configHandler } from '@contentstack/cli-utilities';

import { ProjectsApi } from '../api';
import { LaunchApiError } from '../http/errors';
import { UxLike } from '../output/render';
import { authHeaders, buildServiceContext } from './service-context';

interface CapturedCall {
  baseUrl?: string;
  headers?: Record<string, string>;
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

describe('buildServiceContext', () => {
  it('wires an api surface onto a rest client built from the supplied base url', () => {
    const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux,
      isTTY: true,
    });

    expect(context.api.projects).toBeInstanceOf(ProjectsApi);
    expect(context.ux).toBe(ux);
    expect(context.isTTY).toBe(true);
  });

  it('carries isTTY: false through unchanged', () => {
    const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux,
      isTTY: false,
    });

    expect(context.isTTY).toBe(false);
  });
});

describe('buildServiceContext request wiring', () => {
  it('targets the manage base path under the launch hub url and sends the analytics info header', async () => {
    const captured: CapturedCall[] = [];
    const httpSpy = capturingHttpClient([200], captured);

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });
    await context.api.projects.list({ org: 'org1' });

    expect(captured[0].baseUrl).toBe('https://launch-api.test/manage');
    expect(captured[0].headers?.['X-CS-CLI']).toBe('cli/2.0.0');
    httpSpy.mockRestore();
  });

  it('treats a session with no authorisation type as a token session that is never refreshed', async () => {
    const token = randomUUID();
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const configSpy = jest
      .spyOn(configHandler, 'get')
      .mockImplementation((key: string) => (key === 'authtoken' ? token : undefined));
    const captured: CapturedCall[] = [];
    const httpSpy = capturingHttpClient([401], captured);

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });

    await expect(context.api.projects.list({ org: 'org1' })).rejects.toBeInstanceOf(LaunchApiError);

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

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });

    await expect(context.api.projects.list({ org: 'org1' })).rejects.toBe(failure);

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

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });
    await context.api.projects.list({ org: 'org1' });

    expect(captured).toHaveLength(2);
    expect(captured[0].headers?.authorization).toBe(`Bearer ${staleToken}`);
    expect(captured[1].headers?.authorization).toBe(`Bearer ${freshToken}`);
    expect(expirySpy).toHaveBeenCalledWith(true);
    httpSpy.mockRestore();
    configSpy.mockRestore();
    expirySpy.mockRestore();
  });
});

describe('authHeaders', () => {
  it('returns a bearer authorization header when the authorisation type is OAUTH', async () => {
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const spy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'authorisationType') return 'OAUTH';
      if (key === 'oauthAccessToken') return 'oauth-token-value';
      return undefined;
    });

    const headers = await authHeaders();

    expect(headers).toEqual({ authorization: 'Bearer oauth-token-value' });
    spy.mockRestore();
    expirySpy.mockRestore();
  });

  it('awaits the oauth expiry check before reading the access token', async () => {
    const order: string[] = [];
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockImplementation(async () => {
      await Promise.resolve();
      order.push('expiry-check');
    });
    const spy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'authorisationType') return 'OAUTH';
      if (key === 'oauthAccessToken') {
        order.push('read-token');
        return 'refreshed-token-value';
      }
      return undefined;
    });

    const headers = await authHeaders();

    expect(order).toEqual(['expiry-check', 'read-token']);
    expect(expirySpy).toHaveBeenCalledWith();
    expect(headers).toEqual({ authorization: 'Bearer refreshed-token-value' });
    spy.mockRestore();
    expirySpy.mockRestore();
  });

  it('does not run the oauth expiry check when the authorisation type is BASIC', async () => {
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const spy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'authorisationType') return 'BASIC';
      if (key === 'authtoken') return 'basic-token-value';
      return undefined;
    });

    const headers = await authHeaders();

    expect(headers).toEqual({ authtoken: 'basic-token-value' });
    expect(expirySpy).not.toHaveBeenCalled();
    spy.mockRestore();
    expirySpy.mockRestore();
  });
});

describe('buildServiceContext auth refresh', () => {
  it('does not touch credentials when a BASIC session gets a 401', async () => {
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const configSpy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'authorisationType') return 'BASIC';
      if (key === 'authtoken') return 'basic-token-value';
      return undefined;
    });
    const httpSpy = jest.spyOn(HttpClient, 'create').mockImplementation(() => {
      const client: Record<string, unknown> = {};
      client.baseUrl = () => client;
      client.asJson = () => client;
      client.headers = () => client;
      client.queryParams = () => client;
      client.payload = () => client;
      client.send = async () => ({ status: 401, data: { errors: [] } });
      return client as unknown as ReturnType<typeof HttpClient.create>;
    });

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });

    await expect(context.api.projects.list({ org: 'org1' })).rejects.toBeDefined();

    expect(expirySpy).not.toHaveBeenCalled();
    httpSpy.mockRestore();
    configSpy.mockRestore();
    expirySpy.mockRestore();
  });

  it('forces a token refresh and retries once when the api answers 401', async () => {
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const configSpy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'authorisationType') return 'OAUTH';
      if (key === 'oauthAccessToken') return 'oauth-token-value';
      return undefined;
    });
    const statuses = [401, 200];
    let index = 0;
    const httpSpy = jest.spyOn(HttpClient, 'create').mockImplementation(() => {
      const client: Record<string, unknown> = {};
      client.baseUrl = () => client;
      client.asJson = () => client;
      client.headers = () => client;
      client.queryParams = () => client;
      client.payload = () => client;
      client.send = async () => ({
        status: statuses[index++],
        data: { projects: [], pagination: { count: 0, limit: 0, skip: 0 } },
      });
      return client as unknown as ReturnType<typeof HttpClient.create>;
    });

    const context = buildServiceContext({
      launchHubUrl: 'https://launch-api.test',
      analyticsInfo: 'cli/2.0.0',
      ux: { print: () => undefined, inquire: async () => undefined as never },
      isTTY: false,
    });
    const page = await context.api.projects.list({ org: 'org1' });

    expect(index).toBe(2);
    expect(expirySpy).toHaveBeenCalledWith(true);
    expect(page.projects).toEqual([]);
    httpSpy.mockRestore();
    configSpy.mockRestore();
    expirySpy.mockRestore();
  });
});
