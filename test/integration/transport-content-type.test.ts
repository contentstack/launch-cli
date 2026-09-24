import { randomBytes, randomUUID } from 'node:crypto';

import nock from 'nock';

import { HTTP_METHODS, HttpMethod, RestApiClient } from '../../src/transport/rest-client';
import { SourceFile, describeOccurrence, enclosingObject, lineOf, occurrences, productionSources } from '../support/sources';

const ORIGIN = 'https://launch-api.content-type.test';
const BASE_PATH = '/manage';
const ORG_UID = `blt${randomBytes(8).toString('hex')}`;
const PROJECT_UID = randomBytes(12).toString('hex');
const TYPED_WHEN_BODYLESS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH'];
const CORRECT_WHEN_BODYLESS = HTTP_METHODS.filter((method) => !TYPED_WHEN_BODYLESS.includes(method));

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

function bodylessRequests(source: SourceFile): string[] {
  return [...source.text.matchAll(new RegExp(`method:\\s*'(${TYPED_WHEN_BODYLESS.join('|')})'`, 'g'))]
    .filter((match) => !/\bbody\s*[:,}]/.test(enclosingObject(source.text, match.index as number)))
    .map((match) => `src/${source.path}:${lineOf(source.text, match.index as number)}`);
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

  it('splits the methods between the ones proven correct bodyless and the known defect, and loses none', () => {
    expect([...CORRECT_WHEN_BODYLESS, ...TYPED_WHEN_BODYLESS].sort()).toEqual([...HTTP_METHODS].sort());
  });

  it.each(CORRECT_WHEN_BODYLESS.map((method) => [method]))(
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

  it.failing.each(TYPED_WHEN_BODYLESS.map((method) => [method]))(
    'KNOWN DEFECT, not yet fixed: a bodyless %s still goes out as application/x-www-form-urlencoded - fix the transport, then move the method to the proven list',
    async (method) => {
      const path = unseenEndpoint();
      const seen = recordHeaders(method, path, 204);

      await buildClient().request({ method, path, orgUid: ORG_UID, projectUid: PROJECT_UID });

      expect(seen.headers).not.toHaveProperty('content-type');
    },
  );

  it('issues no POST, PUT or PATCH without a body anywhere in src while the transport still types a bodyless one', () => {
    const bodyless = productionSources().flatMap((source) =>
      bodylessRequests(source).map((site) => `${site} sends no body, so it would declare a content type it does not have`),
    );

    expect(bodyless).toEqual([]);
  });

  it('reports a bodyless POST literal and ignores one that carries a body, so the source check cannot go green vacuously', () => {
    const source: SourceFile = {
      path: 'probe/probe.api.ts',
      text: [
        'await this.request({',
        "  method: 'POST',",
        '  path: `/deployments/${uid}/redeploy`,',
        '});',
        'await this.request({ method: \'PUT\', path: \'/x\', body: { a: 1 } });',
      ].join('\n'),
    };

    expect(bodylessRequests(source)).toEqual(['src/probe/probe.api.ts:2']);
  });

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
