import { randomUUID } from 'node:crypto';

import nock from 'nock';

import { RestApiClient } from '../../src/transport/rest-client';

const ORIGIN = 'https://launch-api.transport.test';
const BASE_PATH = '/manage';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0-alpha.0 darwin-arm64 node-v22.0.0';

const TIMEOUT_ERROR = { message: 'timeout of 2000ms exceeded', code: 'ECONNABORTED' };

function buildClient(overrides: Partial<ConstructorParameters<typeof RestApiClient>[0]> = {}): RestApiClient {
  return new RestApiClient({
    baseUrl: `${ORIGIN}${BASE_PATH}`,
    analyticsInfo: ANALYTICS_INFO,
    authHeaders: async () => ({ authtoken: randomUUID() }),
    retryDelayMs: 0,
    sleep: async () => undefined,
    ...overrides,
  });
}

function postAttempts(count: number): nock.Scope[] {
  return Array.from({ length: count }, () =>
    nock(ORIGIN).post(`${BASE_PATH}/projects`).replyWithError(TIMEOUT_ERROR),
  );
}

function getAttempts(count: number, status: number): nock.Scope[] {
  return Array.from({ length: count }, () =>
    nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .reply(status, { errors: [{ code: 'launch.RATE_LIMITED', message: 'Too many requests.' }] }),
  );
}

describe('integration: transport-level retries', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('sends a timed-out POST exactly once and surfaces the failure to the caller', async () => {
    const attempts = postAttempts(4);

    const rejection = await buildClient()
      .request({ method: 'POST', path: '/projects', body: { name: 'site' }, orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, false, false, false]);
  });

  it('sends a timed-out GET exactly once because a transport failure is not a retryable status', async () => {
    const attempts = Array.from({ length: 4 }, () =>
      nock(ORIGIN).get(`${BASE_PATH}/projects`).replyWithError(TIMEOUT_ERROR),
    );

    const rejection = await buildClient()
      .request({ method: 'GET', path: '/projects', orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, false, false, false]);
  });

  it('retries a throttled GET exactly maxRetries times and no more', async () => {
    const attempts = getAttempts(6, 429);

    const rejection = await buildClient({ maxRetries: 3 })
      .request({ method: 'GET', path: '/projects', orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, true, true, true, false, false]);
  });

  it('never runs the utility token refresh when the body carries an expired-token message', async () => {
    const expired = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .reply(401, { error_message: 'access token is invalid or expired' });
    const second = nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(200, { projects: [] });
    const refreshAuth = jest.fn(async () => undefined);

    const result = await buildClient({ refreshAuth }).request({ method: 'GET', path: '/projects', orgUid: ORG_UID });

    expect(result).toEqual({ projects: [] });
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(expired.isDone()).toBe(true);
    expect(second.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });
});
