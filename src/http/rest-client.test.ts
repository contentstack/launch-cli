import { HttpClient } from '@contentstack/cli-utilities';

import { API_VERSION } from '../config/constants';
import { LaunchApiError } from './errors';
import { HttpClientLike, RestApiClient } from './rest-client';

function fakeHttpClient(responses: { status: number; data: unknown }[]) {
  const calls: { method: string; path: string; headers: Record<string, string>; query?: object; body?: unknown }[] = [];
  let index = 0;

  const create = (): HttpClientLike => {
    const call: { method: string; path: string; headers: Record<string, string>; query?: object; body?: unknown } = {
      method: '',
      path: '',
      headers: {},
    };
    const client: HttpClientLike = {
      baseUrl: () => client,
      asJson: () => client,
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
        return responses[Math.min(index++, responses.length - 1)];
      },
    };
    return client;
  };

  return { create, calls };
}

function buildClient(http: ReturnType<typeof fakeHttpClient>, overrides = {}) {
  return new RestApiClient({
    baseUrl: 'https://launch-api.test/manage',
    analyticsInfo: 'cli/2.0.0',
    authHeaders: async () => ({ authtoken: 'tok' }),
    createHttpClient: http.create,
    sleep: async () => undefined,
    ...overrides,
  });
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
    expect(http.calls[0].headers).toEqual({
      'X-CS-CLI': 'cli/2.0.0',
      'x-cs-api-version': API_VERSION,
      authtoken: 'tok',
      'x-organization-uid': 'org1',
      'x-project-uid': 'proj1',
    });
  });

  it('omits query and body and the scoping headers when they are not supplied', async () => {
    const http = fakeHttpClient([{ status: 200, data: {} }]);

    const result = await buildClient(http).request({ method: 'GET', path: '/projects' });

    expect(result).toEqual({});
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].method).toBe('GET');
    expect(http.calls[0].path).toBe('/projects');
    expect(http.calls[0].query).toBeUndefined();
    expect(http.calls[0].body).toBeUndefined();
    expect(http.calls[0].headers['x-organization-uid']).toBeUndefined();
    expect(http.calls[0].headers['x-project-uid']).toBeUndefined();
    expect(http.calls[0].headers).toEqual({
      'X-CS-CLI': 'cli/2.0.0',
      'x-cs-api-version': API_VERSION,
      authtoken: 'tok',
    });
  });

  it('refreshes auth once on 401 and retries', async () => {
    const http = fakeHttpClient([
      { status: 401, data: {} },
      { status: 200, data: { ok: true } },
    ]);
    const refreshAuth = jest.fn(async () => undefined);

    const result = await buildClient(http, { refreshAuth }).request({ method: 'GET', path: '/projects' });

    expect(result).toEqual({ ok: true });
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(http.calls).toHaveLength(2);
  });

  it('throws when a 401 persists after a single refresh', async () => {
    const http = fakeHttpClient([{ status: 401, data: { errors: [{ code: 'launch.AUTH', message: 'nope' }] } }]);
    const refreshAuth = jest.fn(async () => undefined);

    await expect(buildClient(http, { refreshAuth }).request({ method: 'GET', path: '/projects' })).rejects.toBeInstanceOf(
      LaunchApiError,
    );
    expect(http.calls).toHaveLength(2);
    expect(refreshAuth).toHaveBeenCalledTimes(1);

    const error = (await buildClient(fakeHttpClient([{ status: 401, data: { errors: [{ code: 'launch.AUTH', message: 'nope' }] } }]), {
      refreshAuth: async () => undefined,
    })
      .request({ method: 'GET', path: '/projects' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('launch.AUTH');
    expect(error.message).toBe('nope');
    expect(error.errors).toEqual([{ code: 'launch.AUTH', message: 'nope' }]);
  });

  it('does not attempt a refresh when no refreshAuth is configured', async () => {
    const http = fakeHttpClient([{ status: 401, data: {} }]);

    const error = (await buildClient(http, { refreshAuth: undefined })
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
    const http = fakeHttpClient([{ status: 404, data: { errors: [{ code: 'launch.PROJECT.NOT_FOUND', message: 'x' }] } }]);

    await expect(buildClient(http).request({ method: 'GET', path: '/projects/p1' })).rejects.toThrow(
      'No project found with that name or UID.',
    );
    expect(http.calls).toHaveLength(1);

    const error = (await buildClient(fakeHttpClient([{ status: 404, data: { errors: [{ code: 'launch.PROJECT.NOT_FOUND', message: 'x' }] } }]))
      .request({ method: 'GET', path: '/projects/p1' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('launch.PROJECT.NOT_FOUND');
    expect(error.errors).toEqual([{ code: 'launch.PROJECT.NOT_FOUND', message: 'x' }]);
  });

  it('uses the real sleep and default retry settings when none are injected', async () => {
    const http = fakeHttpClient([{ status: 200, data: { ok: true } }]);
    const client = new RestApiClient({
      baseUrl: 'https://launch-api.test/manage',
      analyticsInfo: 'cli/2.0.0',
      authHeaders: async () => ({}),
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
      authHeaders: async () => ({}),
      createHttpClient: http.create,
      retryDelayMs: 1,
    });

    await expect(client.request({ method: 'GET', path: '/projects' })).resolves.toEqual({ ok: 2 });
    expect(http.calls).toHaveLength(2);
  });

  it('creates a fresh HttpClient per request when none is injected', async () => {
    const fakeClient: Record<string, unknown> = {};
    fakeClient.baseUrl = () => fakeClient;
    fakeClient.asJson = () => fakeClient;
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
      authHeaders: async () => ({}),
    });

    await expect(client.request({ method: 'GET', path: '/projects' })).resolves.toEqual({ fromDefaultClient: true });
    expect(createSpy).toHaveBeenCalledTimes(1);

    createSpy.mockRestore();
  });
});
