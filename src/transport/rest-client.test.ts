import { randomUUID } from 'node:crypto';

import { HttpClient, configHandler } from '@contentstack/cli-utilities';

import { API_VERSION } from '../core/constants';
import { LaunchApiError, LaunchNetworkError } from './errors';
import { HttpClientLike, RestApiClient } from './rest-client';

interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  baseUrl?: string;
  query?: object;
  body?: unknown;
  json?: boolean;
}

function fakeHttpClient(responses: ({ status: number; data: unknown } | Error)[]) {
  const calls: RecordedCall[] = [];
  const waits: number[] = [];
  let index = 0;

  const create = (): HttpClientLike => {
    const call: RecordedCall = { method: '', path: '', headers: {} };
    const client: HttpClientLike = {
      baseUrl: (url) => {
        call.baseUrl = url;
        return client;
      },
      asJson: () => {
        call.json = true;
        return client;
      },
      headers: (h) => {
        call.headers = h;
        return client;
      },
      queryParams: (q) => {
        call.query = q;
        return client;
      },
      payload: (b) => {
        call.body = b;
        return client;
      },
      send: async (method, path) => {
        call.method = method;
        call.path = path;
        calls.push(call);
        const next = responses[Math.min(index++, responses.length - 1)];

        if (next instanceof Error) {
          throw next;
        }

        return next;
      },
    };
    return client;
  };

  const sleep = async (ms: number) => {
    waits.push(ms);
  };

  return { create, calls, waits, sleep };
}

function buildClient(http: ReturnType<typeof fakeHttpClient>, overrides = {}) {
  return new RestApiClient({
    baseUrl: 'https://launch-api.test/manage',
    analyticsInfo: 'cli/2.0.0',
    auth: { headers: async () => ({ authtoken: 'tok' }) },
    createHttpClient: http.create,
    sleep: http.sleep,
    ...overrides,
  });
}

function withoutProxy(): () => void {
  const configSpy = jest.spyOn(configHandler, 'get').mockImplementation(() => undefined);
  const savedHttps = process.env.HTTPS_PROXY;
  const savedHttp = process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;

  return () => {
    if (savedHttps !== undefined) process.env.HTTPS_PROXY = savedHttps;
    if (savedHttp !== undefined) process.env.HTTP_PROXY = savedHttp;
    configSpy.mockRestore();
  };
}

describe('RestApiClient', () => {
  it('sends the declared method, path, query, body and headers and returns the payload', async () => {
    const http = fakeHttpClient([{ status: 200, data: { projects: [] } }]);

    const result = await buildClient(http).request({
      method: 'POST',
      path: '/projects',
      query: { limit: 50, skip: undefined },
      body: { name: 'site' },
      orgUid: 'org1',
      projectUid: 'proj1',
    });

    expect(result).toEqual({ projects: [] });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].method).toBe('POST');
    expect(http.calls[0].path).toBe('/projects');
    expect(http.calls[0].query).toEqual({ limit: 50 });
    expect(http.calls[0].body).toEqual({ name: 'site' });
    expect(http.calls[0].json).toBe(true);
    expect(http.calls[0].headers).toEqual({
      'X-CS-CLI': 'cli/2.0.0',
      'x-cs-api-version': API_VERSION,
      authtoken: 'tok',
      'x-organization-uid': 'org1',
      'x-project-uid': 'proj1',
    });
  });

  it.each(['', '   '])('refuses to send a request scoped by the blank organization uid %j', async (blank) => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);

    const promise = buildClient(http).request({ method: 'GET', path: '/projects', orgUid: blank });

    await expect(promise).rejects.toThrow(
      'x-organization-uid was given a blank value; an unscoped Launch API request is never correct.',
    );
    expect(http.calls).toHaveLength(0);
  });

  it.each(['', '   '])('refuses to send a request scoped by the blank project uid %j', async (blank) => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);

    const promise = buildClient(http).request({
      method: 'GET',
      path: '/projects/x',
      orgUid: 'org1',
      projectUid: blank,
    });

    await expect(promise).rejects.toThrow(
      'x-project-uid was given a blank value; an unscoped Launch API request is never correct.',
    );
    expect(http.calls).toHaveLength(0);
  });

  it('omits query and body and the scoping headers when they are not supplied', async () => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);

    const result = await buildClient(http).request({ method: 'GET', path: '/projects' });

    expect(result).toEqual({});
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].method).toBe('GET');
    expect(http.calls[0].path).toBe('/projects');
    expect(http.calls[0].query).toBeUndefined();
    expect(http.calls[0].json).toBeUndefined();
    expect(http.calls[0].body).toBeUndefined();
    expect(http.calls[0].headers['x-organization-uid']).toBeUndefined();
    expect(http.calls[0].headers['x-project-uid']).toBeUndefined();
    expect(http.calls[0].headers).toEqual({
      'X-CS-CLI': 'cli/2.0.0',
      'x-cs-api-version': API_VERSION,
      authtoken: 'tok',
    });
  });

  it.each([[null], [0], ['']])('sends a falsy body %p rather than treating it as absent', async (body) => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);

    await buildClient(http).request({ method: 'POST', path: '/projects', body });

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].body).toBe(body);
    expect(http.calls[0].json).toBe(true);
  });

  it('omits the payload only when the body is undefined', async () => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);

    await buildClient(http).request({ method: 'POST', path: '/projects', body: undefined });

    expect(http.calls[0].body).toBeUndefined();
    expect(http.calls[0].json).toBeUndefined();
  });

  it('refreshes auth once on 401 and retries', async () => {
    const http = fakeHttpClient([
      { status: 401, data: {} },
      { status: 200, data: { ok: true } },
    ]);
    const refresh = jest.fn(async () => undefined);

    const result = await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } }).request({
      method: 'GET',
      path: '/projects',
    });

    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.calls).toHaveLength(2);
  });

  it('throws when a 401 persists after a single refresh', async () => {
    const http = fakeHttpClient([{ status: 401, data: { errors: [{ code: 'launch.AUTH', message: 'nope' }] } }]);
    const refresh = jest.fn(async () => undefined);

    await expect(
      buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } }).request({
        method: 'GET',
        path: '/projects',
      }),
    ).rejects.toBeInstanceOf(LaunchApiError);
    expect(http.calls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);

    const error = (await buildClient(fakeHttpClient([{ status: 401, data: { errors: [{ code: 'launch.AUTH', message: 'nope' }] } }]), {
      auth: { headers: async () => ({ authtoken: 'tok' }), refresh: async () => undefined },
    })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('launch.AUTH');
    expect(error.message).toBe('nope');
    expect(error.errors).toEqual([{ code: 'launch.AUTH', message: 'nope' }]);
  });

  it('does not attempt a refresh when the auth strategy cannot refresh', async () => {
    const http = fakeHttpClient([{ status: 401, data: {} }]);

    const error = (await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }) } })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('launch.UNKNOWN');
    expect(error.message).toBe('Launch API request failed with status 401.');
    expect(error.errors).toEqual([]);
    expect(http.calls).toHaveLength(1);
  });

  it.each([408, 429])('retries a GET %i up to maxRetries then throws', async (status) => {
    const http = fakeHttpClient([{ status, data: {} }]);

    const error = (await buildClient(http, { maxRetries: 2, retryDelayMs: 10 })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(status);
    expect(error.code).toBe('launch.UNKNOWN');
    expect(error.errors).toEqual([]);
    expect(http.calls).toHaveLength(3);
  });

  it.each(['GET', 'HEAD'] as const)('retries a 408 for an idempotent %s up to maxRetries then throws', async (method) => {
    const http = fakeHttpClient([{ status: 408, data: {} }]);

    const error = (await buildClient(http, { maxRetries: 2, retryDelayMs: 10 })
      .request({ method, path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(408);
    expect(http.calls).toHaveLength(3);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'throws a 408 immediately for a non-idempotent %s rather than repeating it',
    async (method) => {
      const http = fakeHttpClient([{ status: 408, data: {} }]);

      const error = (await buildClient(http, { maxRetries: 2, retryDelayMs: 10 })
        .request({ method, path: '/deployments' })
        .catch((e) => e)) as LaunchApiError;

      expect(error).toBeInstanceOf(LaunchApiError);
      expect(error.status).toBe(408);
      expect(error.code).toBe('launch.UNKNOWN');
      expect(error.errors).toEqual([]);
      expect(http.calls).toHaveLength(1);
    },
  );

  it('retries a 429 for a non-idempotent POST', async () => {
    const http = fakeHttpClient([
      { status: 429, data: {} },
      { status: 200, data: { ok: 1 } },
    ]);

    await expect(buildClient(http).request({ method: 'POST', path: '/deployments' })).resolves.toEqual({ ok: 1 });
    expect(http.calls).toHaveLength(2);
  });

  it('returns the payload when a retried request eventually succeeds', async () => {
    const http = fakeHttpClient([
      { status: 429, data: {} },
      { status: 200, data: { ok: 1 } },
    ]);

    await expect(buildClient(http).request({ method: 'GET', path: '/projects' })).resolves.toEqual({ ok: 1 });
    expect(http.calls).toHaveLength(2);
  });

  it('throws immediately on a non-retryable failure', async () => {
    const http = fakeHttpClient([{ status: 404, data: { errors: [{ code: 'launch.RESOURCE.NOT_FOUND', message: 'x' }] } }]);

    await expect(buildClient(http).request({ method: 'GET', path: '/projects/p1' })).rejects.toThrow('x');
    expect(http.calls).toHaveLength(1);

    const error = (await buildClient(fakeHttpClient([{ status: 404, data: { errors: [{ code: 'launch.RESOURCE.NOT_FOUND', message: 'x' }] } }]))
      .request({ method: 'GET', path: '/projects/p1' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('launch.RESOURCE.NOT_FOUND');
    expect(error.errors).toEqual([{ code: 'launch.RESOURCE.NOT_FOUND', message: 'x' }]);
  });

  it('applies the wording the caller supplied for the code the API returned', async () => {
    const http = fakeHttpClient([{ status: 404, data: { errors: [{ code: 'launch.RESOURCE.NOT_FOUND', message: 'x' }] } }]);

    const error = (await buildClient(http)
      .request({ method: 'GET', path: '/projects/p1' }, { 'launch.RESOURCE.NOT_FOUND': 'Nothing of that name here.' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.message).toBe('Nothing of that name here.');
    expect(error.code).toBe('launch.RESOURCE.NOT_FOUND');
    expect(error.errors).toEqual([{ code: 'launch.RESOURCE.NOT_FOUND', message: 'x' }]);
  });

  it('passes the configured base url to the http client on every attempt', async () => {
    const http = fakeHttpClient([
      { status: 429, data: {} },
      { status: 200, data: { ok: true } },
    ]);

    await buildClient(http, { retryDelayMs: 10 }).request({ method: 'GET', path: '/projects' });

    expect(http.calls.map((call) => call.baseUrl)).toEqual([
      'https://launch-api.test/manage',
      'https://launch-api.test/manage',
    ]);
  });

  it('passes the request org uid to the auth strategy so it can scope the credentials', async () => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);
    const seen: (string | undefined)[] = [];
    const headers = async (orgUid?: string) => {
      seen.push(orgUid);
      return {};
    };

    await buildClient(http, { auth: { headers } }).request({ method: 'GET', path: '/projects', orgUid: 'org1' });
    await buildClient(http, { auth: { headers } }).request({ method: 'GET', path: '/projects' });

    expect(seen).toEqual(['org1', undefined]);
  });

  it('backs off by retryDelayMs times the attempt number between retries', async () => {
    const http = fakeHttpClient([{ status: 429, data: {} }]);

    await buildClient(http, { maxRetries: 2, retryDelayMs: 10 })
      .request({ method: 'GET', path: '/projects' })
      .catch(() => undefined);

    expect(http.waits).toEqual([10, 20]);
  });

  it('exhausts the default of three retries when maxRetries is not configured', async () => {
    const http = fakeHttpClient([{ status: 429, data: {} }]);

    await expect(buildClient(http, { retryDelayMs: 10 }).request({ method: 'GET', path: '/projects' })).rejects.toBeInstanceOf(
      LaunchApiError,
    );

    expect(http.calls).toHaveLength(4);
    expect(http.waits).toEqual([10, 20, 30]);
  });

  it('carries a freshly fetched token on the retry that follows a 401 refresh', async () => {
    const http = fakeHttpClient([
      { status: 401, data: {} },
      { status: 200, data: { ok: true } },
    ]);
    const staleToken = randomUUID();
    const freshToken = randomUUID();
    let token = staleToken;
    const headers = jest.fn(async () => ({ authtoken: token }));
    const refresh = async () => {
      token = freshToken;
    };

    await buildClient(http, { auth: { headers, refresh } }).request({ method: 'GET', path: '/projects' });

    expect(headers).toHaveBeenCalledTimes(2);
    expect(http.calls[0].headers.authtoken).toBe(staleToken);
    expect(http.calls[1].headers.authtoken).toBe(freshToken);
  });

  it('propagates a refresh rejection unchanged rather than wrapping it in a LaunchApiError', async () => {
    const http = fakeHttpClient([{ status: 401, data: {} }]);
    const failure = new Error('oauth refresh failed');
    const refresh = async () => {
      throw failure;
    };

    const error = await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e);

    expect(error).toBe(failure);
    expect(error).not.toBeInstanceOf(LaunchApiError);
    expect(http.calls).toHaveLength(1);
  });

  it('retries an idempotent request whose transport failed and returns the payload once it succeeds', async () => {
    const restore = withoutProxy();
    const http = fakeHttpClient([
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      { status: 200, data: { ok: true } },
    ]);

    await expect(buildClient(http, { retryDelayMs: 10 }).request({ method: 'GET', path: '/projects' })).resolves.toEqual({
      ok: true,
    });
    expect(http.calls).toHaveLength(2);
    expect(http.waits).toEqual([10]);
    restore();
  });

  it('gives an exhausted transport failure CLI wording rather than raw axios text', async () => {
    const restore = withoutProxy();
    const transportError = Object.assign(new Error('getaddrinfo ENOTFOUND launch-api.test'), { code: 'ENOTFOUND' });
    const http = fakeHttpClient([transportError]);

    const error = (await buildClient(http, { maxRetries: 2, retryDelayMs: 10 })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchNetworkError;

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect(error.message).toBe('Could not reach the Launch API (ENOTFOUND). Check your network connection and try again.');
    expect(error.cause).toBe(transportError);
    expect(http.calls).toHaveLength(3);
    expect(http.waits).toEqual([10, 20]);
    restore();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'sends a transport-failed %s exactly once rather than repeating a write',
    async (method) => {
      const restore = withoutProxy();
      const transportError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      const http = fakeHttpClient([transportError]);

      const error = (await buildClient(http, { maxRetries: 3, retryDelayMs: 10 })
        .request({ method, path: '/deployments', body: { name: 'site' } })
        .catch((e) => e)) as LaunchNetworkError;

      expect(error).toBeInstanceOf(LaunchNetworkError);
      expect(error.cause).toBe(transportError);
      expect(http.calls).toHaveLength(1);
      expect(http.waits).toEqual([]);
      restore();
    },
  );

  it('leaves a rejection that is not a transport failure untouched and does not retry it', async () => {
    const restore = withoutProxy();
    const failure = new Error('Unexpected token < in JSON at position 0');
    const http = fakeHttpClient([failure]);

    const error = await buildClient(http, { retryDelayMs: 10 })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e);

    expect(error).toBe(failure);
    expect(http.calls).toHaveLength(1);
    expect(http.waits).toEqual([]);
    restore();
  });

  it('refreshes once when a non-2xx body reports the access token invalid or expired', async () => {
    const http = fakeHttpClient([
      { status: 403, data: { error_message: 'access token is invalid or expired' } },
      { status: 200, data: { ok: true } },
    ]);
    const refresh = jest.fn(async () => undefined);

    const result = await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } }).request({
      method: 'GET',
      path: '/projects',
    });

    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.calls).toHaveLength(2);
  });

  it('refreshes only once when the body keeps reporting the access token invalid or expired', async () => {
    const http = fakeHttpClient([{ status: 403, data: { error_message: 'access token is invalid or expired' } }]);
    const refresh = jest.fn(async () => undefined);

    const error = (await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(403);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.calls).toHaveLength(2);
  });

  it('does not treat a successful body carrying that wording as an auth challenge', async () => {
    const http = fakeHttpClient([{ status: 200, data: { error_message: 'access token is invalid or expired' } }]);
    const refresh = jest.fn(async () => undefined);

    const result = await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } }).request({
      method: 'GET',
      path: '/projects',
    });

    expect(result).toEqual({ error_message: 'access token is invalid or expired' });
    expect(refresh).not.toHaveBeenCalled();
    expect(http.calls).toHaveLength(1);
  });

  it.each([[{ error_message: 'something else entirely' }], [{ error_message: 42 }], [null], ['text body']])(
    'does not read %p as an auth challenge',
    async (data) => {
      const http = fakeHttpClient([{ status: 403, data }]);
      const refresh = jest.fn(async () => undefined);

      await buildClient(http, { auth: { headers: async () => ({ authtoken: 'tok' }), refresh } })
        .request({ method: 'GET', path: '/projects' })
        .catch(() => undefined);

      expect(refresh).not.toHaveBeenCalled();
      expect(http.calls).toHaveLength(1);
    },
  );

  it('turns a refused connection behind a configured proxy into the proxy diagnostic', async () => {
    const configSpy = jest
      .spyOn(configHandler, 'get')
      .mockImplementation((key: string) => (key === 'proxy' ? { protocol: 'http', host: 'corp.internal', port: 3128 } : undefined));
    const transportError = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:3128'), { code: 'ECONNREFUSED' });
    const http = fakeHttpClient([transportError]);

    const error = (await buildClient(http, { retryDelayMs: 10 })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchNetworkError;

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect(error.message).toBe(
      'Proxy error: Unable to connect to proxy server at http://corp.internal:3128. Please verify your proxy configuration.',
    );
    expect(error.cause).toBe(transportError);
    expect(http.calls).toHaveLength(1);
    expect(http.waits).toEqual([]);
    configSpy.mockRestore();
  });

  it.each([200, 204, 299])('treats %i as a success and returns the payload', async (status) => {
    const http = fakeHttpClient([{ status, data: { ok: true } }]);

    await expect(buildClient(http).request({ method: 'GET', path: '/projects' })).resolves.toEqual({ ok: true });
    expect(http.calls).toHaveLength(1);
  });

  it.each([300, 304])('treats %i as a failure and throws a LaunchApiError', async (status) => {
    const http = fakeHttpClient([{ status, data: {} }]);

    const error = (await buildClient(http)
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(status);
    expect(http.calls).toHaveLength(1);
  });

  it('refreshes on a 401 and then still retries a 429 before succeeding', async () => {
    const http = fakeHttpClient([
      { status: 401, data: {} },
      { status: 429, data: {} },
      { status: 200, data: { ok: true } },
    ]);
    const refresh = jest.fn(async () => undefined);

    await expect(
      buildClient(http, {
        auth: { headers: async () => ({ authtoken: 'tok' }), refresh },
        retryDelayMs: 10,
      }).request({ method: 'GET', path: '/projects' }),
    ).resolves.toEqual({ ok: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.calls).toHaveLength(3);
    expect(http.waits).toEqual([10]);
  });

  it('still allows the refresh when the 401 arrives after a retried 429', async () => {
    const http = fakeHttpClient([
      { status: 429, data: {} },
      { status: 401, data: {} },
      { status: 200, data: { ok: true } },
    ]);
    const refresh = jest.fn(async () => undefined);

    await expect(
      buildClient(http, {
        auth: { headers: async () => ({ authtoken: 'tok' }), refresh },
        retryDelayMs: 10,
      }).request({ method: 'GET', path: '/projects' }),
    ).resolves.toEqual({ ok: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.calls).toHaveLength(3);
    expect(http.waits).toEqual([10]);
  });

  it('uses the real sleep and default retry settings when none are injected', async () => {
    const http = fakeHttpClient([{ status: 200, data: { ok: true } }]);
    const client = new RestApiClient({
      baseUrl: 'https://launch-api.test/manage',
      analyticsInfo: 'cli/2.0.0',
      auth: { headers: async () => ({}) },
      createHttpClient: http.create,
    });

    await expect(client.request({ method: 'GET', path: '/projects' })).resolves.toEqual({ ok: true });
  });

  it('uses the real sleep implementation to wait between retries when none is injected', async () => {
    const http = fakeHttpClient([
      { status: 429, data: {} },
      { status: 200, data: { ok: 2 } },
    ]);
    const client = new RestApiClient({
      baseUrl: 'https://launch-api.test/manage',
      analyticsInfo: 'cli/2.0.0',
      auth: { headers: async () => ({}) },
      createHttpClient: http.create,
      retryDelayMs: 1,
    });

    await expect(client.request({ method: 'GET', path: '/projects' })).resolves.toEqual({ ok: 2 });
    expect(http.calls).toHaveLength(2);
  });

  it('creates a fresh HttpClient per request when none is injected', async () => {
    const registered: unknown[] = [];
    const fakeClient: Record<string, unknown> = {
      interceptors: { response: { use: (...args: unknown[]) => registered.push(args) } },
    };
    fakeClient.baseUrl = () => fakeClient;
    fakeClient.asJson = () => fakeClient;
    fakeClient.requestConfig = () => ({});
    fakeClient.headers = () => fakeClient;
    fakeClient.queryParams = () => fakeClient;
    fakeClient.payload = () => fakeClient;
    fakeClient.send = async () => ({ status: 200, data: { fromDefaultClient: true } });
    const createSpy = jest
      .spyOn(HttpClient, 'create')
      .mockReturnValue(fakeClient as unknown as ReturnType<typeof HttpClient.create>);

    const client = new RestApiClient({
      baseUrl: 'https://launch-api.test/manage',
      analyticsInfo: 'cli/2.0.0',
      auth: { headers: async () => ({}) },
    });

    await expect(client.request({ method: 'GET', path: '/projects' })).resolves.toEqual({ fromDefaultClient: true });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(registered).toEqual([]);

    (fakeClient.interceptors as { response: { use: (...args: unknown[]) => unknown } }).response.use(null, () => 0);
    expect(registered).toEqual([]);

    createSpy.mockRestore();
  });
});
