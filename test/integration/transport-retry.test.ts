import { randomUUID } from 'node:crypto';

import nock from 'nock';

import { LaunchNetworkError } from '../../src/transport/errors';
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
    auth: { headers: async () => ({ authtoken: randomUUID() }) },
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

  it('sends a timed-out POST exactly once and explains the failure to the caller', async () => {
    const attempts = postAttempts(4);

    const rejection = await buildClient()
      .request({ method: 'POST', path: '/projects', body: { name: 'site' }, orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(LaunchNetworkError);
    expect((rejection as LaunchNetworkError).message).toBe(
      'Could not reach the Launch API (ECONNABORTED). Check your network connection and try again.',
    );
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, false, false, false]);
  });

  it('retries a timed-out GET up to the budget and then explains the failure', async () => {
    const attempts = Array.from({ length: 5 }, () =>
      nock(ORIGIN).get(`${BASE_PATH}/projects`).replyWithError(TIMEOUT_ERROR),
    );

    const rejection = await buildClient({ maxRetries: 3 })
      .request({ method: 'GET', path: '/projects', orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(LaunchNetworkError);
    expect((rejection as LaunchNetworkError).message).toBe(
      'Could not reach the Launch API (ECONNABORTED). Check your network connection and try again.',
    );
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, true, true, true, false]);
  });

  it('retries a throttled GET exactly maxRetries times and no more', async () => {
    const attempts = getAttempts(6, 429);

    const rejection = await buildClient({ maxRetries: 3 })
      .request({ method: 'GET', path: '/projects', orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, true, true, true, false, false]);
  });

  it('abandons a GET whose server never answers once the request timeout runs out, then retries it within the budget', async () => {
    const attempts = Array.from({ length: 4 }, () =>
      nock(ORIGIN).get(`${BASE_PATH}/projects`).delayConnection(2000).reply(200, { projects: [] }),
    );

    const rejection = await buildClient({ maxRetries: 2, requestTimeoutMs: 50 })
      .request({ method: 'GET', path: '/projects', orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(LaunchNetworkError);
    expect((rejection as LaunchNetworkError).message).toBe(
      'Could not reach the Launch API (ECONNABORTED). Check your network connection and try again.',
    );
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, true, true, false]);
  });

  it('abandons a POST whose server never answers once the request timeout runs out and never sends it again', async () => {
    const attempts = Array.from({ length: 2 }, () =>
      nock(ORIGIN).post(`${BASE_PATH}/projects`).delayConnection(2000).reply(201, { project: {} }),
    );

    const rejection = await buildClient({ maxRetries: 3, requestTimeoutMs: 50 })
      .request({ method: 'POST', path: '/projects', body: { name: 'site' }, orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(LaunchNetworkError);
    expect(attempts.map((attempt) => attempt.isDone())).toEqual([true, false]);
  });

  it.each([502, 503, 504])('retries a GET answered with %i and returns the answer that follows', async (status) => {
    const failed = nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(status, {});
    const recovered = nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(200, { projects: [] });

    const result = await buildClient().request({ method: 'GET', path: '/projects', orgUid: ORG_UID });

    expect(result).toEqual({ projects: [] });
    expect(failed.isDone()).toBe(true);
    expect(recovered.isDone()).toBe(true);
  });

  it.each([502, 503, 504])('never resends a POST answered with %i, because the server may already have acted on it', async (status) => {
    const failed = nock(ORIGIN).post(`${BASE_PATH}/projects`).reply(status, {});
    const resent = nock(ORIGIN).post(`${BASE_PATH}/projects`).reply(201, { project: {} });

    const rejection = await buildClient()
      .request({ method: 'POST', path: '/projects', body: { name: 'site' }, orgUid: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(failed.isDone()).toBe(true);
    expect(resent.isDone()).toBe(false);
  });

  it('waits as long as a Retry-After header in seconds asks before retrying', async () => {
    const waits: number[] = [];
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(429, {}, { 'Retry-After': '7' });
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(200, { projects: [] });

    await buildClient({ retryDelayMs: 1000, sleep: async (ms: number) => void waits.push(ms) }).request({
      method: 'GET',
      path: '/projects',
      orgUid: ORG_UID,
    });

    expect(waits).toEqual([7000]);
  });

  it('keeps its own backoff when a Retry-After header asks for less, is a date, or is not a number', async () => {
    const waits: number[] = [];
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(503, {}, { 'Retry-After': '0' });
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(503, {}, { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' });
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(503, {}, { 'Retry-After': 'soon' });
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(200, { projects: [] });

    await buildClient({ retryDelayMs: 1000, sleep: async (ms: number) => void waits.push(ms) }).request({
      method: 'GET',
      path: '/projects',
      orgUid: ORG_UID,
    });

    expect(waits).toEqual([1000, 2000, 3000]);
  });

  it('caps a Retry-After header at thirty seconds so a hostile or broken server cannot stall the command', async () => {
    const waits: number[] = [];
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(429, {}, { 'Retry-After': '86400' });
    nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(200, { projects: [] });

    await buildClient({ retryDelayMs: 1000, sleep: async (ms: number) => void waits.push(ms) }).request({
      method: 'GET',
      path: '/projects',
      orgUid: ORG_UID,
    });

    expect(waits).toEqual([30000]);
  });

  it('never runs the utility token refresh when the body carries an expired-token message', async () => {
    const expired = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .reply(401, { error_message: 'access token is invalid or expired' });
    const second = nock(ORIGIN).get(`${BASE_PATH}/projects`).reply(200, { projects: [] });
    const refresh = jest.fn(async () => undefined);

    const result = await buildClient({ auth: { headers: async () => ({ authtoken: randomUUID() }), refresh } }).request({
      method: 'GET',
      path: '/projects',
      orgUid: ORG_UID,
    });

    expect(result).toEqual({ projects: [] });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(expired.isDone()).toBe(true);
    expect(second.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });
});
