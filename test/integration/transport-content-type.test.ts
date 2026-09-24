import { randomBytes, randomUUID } from 'node:crypto';

import nock from 'nock';

import { HTTP_METHODS, HttpMethod, RestApiClient } from '../../src/transport/rest-client';
import { describeOccurrence, occurrences, productionSources } from '../support/sources';

const ORIGIN = 'https://launch-api.content-type.test';
const BASE_PATH = '/manage';
const ORG_UID = `blt${randomBytes(8).toString('hex')}`;
const PROJECT_UID = randomBytes(12).toString('hex');

interface Seen {
  headers: Record<string, unknown>;
  body: string[];
}

function buildClient(): RestApiClient {
  return new RestApiClient({
    baseUrl: `${ORIGIN}${BASE_PATH}`,
    analyticsInfo: 'cli/2.0.0',
    auth: { headers: async () => ({ authtoken: randomUUID() }) },
    retryDelayMs: 0,
    sleep: async () => undefined,
  });
}

function unseenEndpoint(): string {
  return `/${randomBytes(4).toString('hex')}/${randomBytes(6).toString('hex')}`;
}

function recordHeaders(method: HttpMethod, path: string, status: number): Seen {
  const seen: Seen = { headers: {}, body: [] };

  nock(ORIGIN)
    .intercept(`${BASE_PATH}${path}`, method)
    .reply(function (_uri, requestBody) {
      seen.headers = this.req.headers;
      seen.body.push(typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody));
      return [status, status === 204 || method === 'HEAD' ? '' : {}];
    });

  return seen;
}

describe('guard: a request declares a JSON content type exactly when it carries a body, for every method the transport supports', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('checks every method the transport can send, so a method added later is covered without editing this file', () => {
    expect([...HTTP_METHODS].sort()).toEqual(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT']);
  });

  it.each(HTTP_METHODS.map((method) => [method]))(
    'sends a bodyless %s with no content-type header, because the Fastify API answers 400 to an empty body declared as JSON',
    async (method) => {
      const path = unseenEndpoint();
      const seen = recordHeaders(method, path, 204);

      await buildClient().request({ method, path, orgUid: ORG_UID, projectUid: PROJECT_UID });

      expect(seen.headers).not.toHaveProperty('content-type');
      expect(seen.headers['x-organization-uid']).toBe(ORG_UID);
      expect(seen.headers['x-project-uid']).toBe(PROJECT_UID);
      expect(seen.body).toEqual(['']);
    },
  );

  it('builds the Launch API HTTP client in exactly one place and lets only the rest client choose a content type', () => {
    const outside = productionSources().flatMap((source) => [
      ...(source.path === 'transport/utility-http-client.ts' ? [] : occurrences(source, /\bHttpClient\b(?!Like)/)),
      ...(source.path === 'transport/rest-client.ts' ? [] : occurrences(source, /\.asJson\(|application\/json/)),
    ]);

    expect(outside.map(describeOccurrence)).toEqual([]);
  });

  it.each(HTTP_METHODS.filter((method) => method !== 'HEAD').map((method) => [method]))(
    'sends a %s that carries a body as application/json',
    async (method) => {
      const path = unseenEndpoint();
      const seen = recordHeaders(method, path, 200);

      await buildClient().request({ method, path, body: { name: 'site' }, orgUid: ORG_UID });

      expect(seen.headers['content-type']).toBe('application/json');
      expect(seen.body).toEqual([JSON.stringify({ name: 'site' })]);
    },
  );

  it.each<[string, unknown]>([
    ['null', null],
    ['false', false],
    ['0', 0],
    ['an empty string', ''],
    ['an empty array', []],
  ])('takes a body of %s as a body and declares it as application/json', async (_label, body) => {
    const path = unseenEndpoint();
    const seen = recordHeaders('POST', path, 200);

    await buildClient().request({ method: 'POST', path, body, orgUid: ORG_UID });

    expect(seen.headers['content-type']).toBe('application/json');
  });
});
