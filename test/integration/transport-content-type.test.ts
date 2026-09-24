import { randomBytes, randomUUID } from 'node:crypto';

import nock from 'nock';

import { HttpMethod, RestApiClient } from '../../src/transport/rest-client';

const ORIGIN = 'https://launch-api.content-type.test';
const BASE_PATH = '/manage';
const ORG_UID = `blt${randomBytes(8).toString('hex')}`;
const PROJECT_UID = randomBytes(12).toString('hex');

function buildClient(): RestApiClient {
  return new RestApiClient({
    baseUrl: `${ORIGIN}${BASE_PATH}`,
    analyticsInfo: 'cli/2.0.0',
    auth: { headers: async () => ({ authtoken: randomUUID() }) },
    retryDelayMs: 0,
    sleep: async () => undefined,
  });
}

function recordHeaders(method: HttpMethod, path: string, status: number): { headers: Record<string, unknown>; body: string[] } {
  const seen: { headers: Record<string, unknown>; body: string[] } = { headers: {}, body: [] };

  nock(ORIGIN)
    .intercept(`${BASE_PATH}${path}`, method)
    .reply(function (_uri, requestBody) {
      seen.headers = this.req.headers;
      seen.body.push(typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody));
      return [status, status === 204 ? '' : {}];
    });

  return seen;
}

describe('integration: the JSON content type goes only on a request that has a body', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it.each<[HttpMethod, number]>([
    ['DELETE', 204],
    ['GET', 200],
  ])('sends a bodyless %s with no content-type header at all', async (method, status) => {
    const seen = recordHeaders(method, `/projects/${PROJECT_UID}`, status);

    await buildClient().request({ method, path: `/projects/${PROJECT_UID}`, orgUid: ORG_UID, projectUid: PROJECT_UID });

    expect(seen.headers).not.toHaveProperty('content-type');
    expect(seen.headers['x-organization-uid']).toBe(ORG_UID);
    expect(seen.headers['x-project-uid']).toBe(PROJECT_UID);
    expect(seen.body).toEqual(['']);
  });

  it.each<[HttpMethod, string]>([
    ['POST', '/projects'],
    ['PUT', `/projects/${PROJECT_UID}`],
  ])('sends a %s that carries a body as application/json', async (method, path) => {
    const seen = recordHeaders(method, path, 200);

    await buildClient().request({ method, path, body: { name: 'site' }, orgUid: ORG_UID });

    expect(seen.headers['content-type']).toBe('application/json');
    expect(seen.body).toEqual([JSON.stringify({ name: 'site' })]);
  });
});
