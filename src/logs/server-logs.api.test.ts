import { randomBytes } from 'node:crypto';

import { MAX_PAGES } from '../core/constants';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { LOGS_ERROR_MESSAGES } from './logs.errors';
import { ServerLogsApi } from './server-logs.api';

const ORG = randomBytes(9).toString('hex');
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');
const DEPLOYMENT = randomBytes(12).toString('hex');

const WINDOW = { org: ORG, project: PROJECT, environment: ENVIRONMENT, deployment: DEPLOYMENT, startTime: 1_000, endTime: 2_000 };

function fakeRestClient(result: unknown) {
  const requests: RestRequest[] = [];
  const messages: unknown[] = [];
  const client = {
    request: async (req: RestRequest, errorMessages: unknown) => {
      requests.push(req);
      messages.push(errorMessages);
      return result;
    },
  } as unknown as RestApiClient;

  return { client, requests, messages };
}

function fakePagedClient(pages: unknown[]) {
  const queries: unknown[] = [];
  const client = {
    request: async (req: RestRequest) => {
      queries.push(req.query);
      return pages[queries.length - 1];
    },
  } as unknown as RestApiClient;

  return { client, queries };
}

async function collect(pages: AsyncIterable<unknown>): Promise<unknown[]> {
  const seen: unknown[] = [];

  for await (const page of pages) {
    seen.push(page);
  }

  return seen;
}

describe('ServerLogsApi', () => {
  it('reads one page oldest-first without search or cursor and returns its entries and page info', async () => {
    const entries = [{ timestamp: '2026-10-28T10:00:00.000Z', message: 'first', source: 'edge', cursor: '[1,"a"]' }];
    const pageInfo = { hasOlder: null, hasNewer: true, oldestCursor: '[1,"a"]', newestCursor: '[1,"a"]' };
    const { client, requests, messages } = fakeRestClient({ serverLogs: entries, pageInfo });

    const result = await new ServerLogsApi(client).page(WINDOW);

    expect(result).toEqual({ logs: entries, pageInfo });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/deployments/${DEPLOYMENT}/logs/server-logs`,
        orgUid: ORG,
        projectUid: PROJECT,
        query: { startTime: 1_000, endTime: 2_000, sortDirection: 'asc' },
      },
    ]);
    expect(messages[0]).toBe(LOGS_ERROR_MESSAGES);
  });

  it('sends the search text and the cursor exactly as given and returns no page info when the server sends none', async () => {
    const cursor = `[${Date.now()},"${randomBytes(6).toString('hex')}"]`;
    const { client, requests } = fakeRestClient({ serverLogs: [] });

    const result = await new ServerLogsApi(client).page({ ...WINDOW, search: 'upstream timeout', cursor });

    expect(result).toEqual({ logs: [], pageInfo: undefined });
    expect(requests[0].query).toEqual({
      startTime: 1_000,
      endTime: 2_000,
      sortDirection: 'asc',
      search: 'upstream timeout',
      cursor,
    });
  });

  it('walks a single page and stops when the server reports nothing newer', async () => {
    const only = { serverLogs: [{ message: 'only' }], pageInfo: { hasNewer: false, newestCursor: '[1,"a"]' } };
    const { client, queries } = fakePagedClient([only, only]);

    const seen = await collect(new ServerLogsApi(client).pages({ ...WINDOW, search: 'x' }));

    expect(seen).toEqual([{ logs: only.serverLogs, pageInfo: only.pageInfo }]);
    expect(queries).toEqual([{ startTime: 1_000, endTime: 2_000, sortDirection: 'asc', search: 'x' }]);
  });

  it('follows the newest cursor of each page with the same window and search until nothing is newer', async () => {
    const first = { serverLogs: [{ message: 'one' }], pageInfo: { hasNewer: true, newestCursor: '[1,"a"]' } };
    const second = { serverLogs: [{ message: 'two' }], pageInfo: { hasNewer: true, newestCursor: '[2,"b"]' } };
    const last = { serverLogs: [{ message: 'three' }], pageInfo: { hasNewer: false, newestCursor: '[3,"c"]' } };
    const { client, queries } = fakePagedClient([first, second, last, last]);

    const seen = await collect(new ServerLogsApi(client).pages({ ...WINDOW, search: 'x', cursor: '[0,"z"]' }));

    expect(seen).toEqual([first, second, last].map(({ serverLogs, pageInfo }) => ({ logs: serverLogs, pageInfo })));
    expect(queries).toEqual([
      { startTime: 1_000, endTime: 2_000, sortDirection: 'asc', search: 'x', cursor: '[0,"z"]' },
      { startTime: 1_000, endTime: 2_000, sortDirection: 'asc', search: 'x', cursor: '[1,"a"]' },
      { startTime: 1_000, endTime: 2_000, sortDirection: 'asc', search: 'x', cursor: '[2,"b"]' },
    ]);
  });

  it.each([
    ['a server without page info', { serverLogs: [{ message: 'one' }] }],
    ['no direction answer', { serverLogs: [{ message: 'one' }], pageInfo: { hasNewer: null, newestCursor: '[1,"a"]' } }],
    ['an empty page that claims more', { serverLogs: [], pageInfo: { hasNewer: true, newestCursor: '[1,"a"]' } }],
    ['no newest cursor', { serverLogs: [{ message: 'one' }], pageInfo: { hasNewer: true, newestCursor: null } }],
    ['a blank newest cursor', { serverLogs: [{ message: 'one' }], pageInfo: { hasNewer: true, newestCursor: ' ' } }],
  ])('stops after one request for %s', async (_case, body: { serverLogs: unknown[]; pageInfo?: unknown }) => {
    const { client, queries } = fakePagedClient([body, body]);

    const seen = await collect(new ServerLogsApi(client).pages(WINDOW));

    expect(seen).toEqual([{ logs: body.serverLogs, pageInfo: body.pageInfo }]);
    expect(queries).toHaveLength(1);
  });

  it('stops after exactly MAX_PAGES requests from a server that always has more, ending on a page that has more', async () => {
    const endless = Array.from({ length: MAX_PAGES + 1 }, (_, index) => ({
      serverLogs: [{ message: `line ${index}` }],
      pageInfo: { hasNewer: true, newestCursor: `[${index},"c"]` },
    }));
    const { client, queries } = fakePagedClient(endless);

    const seen = (await collect(new ServerLogsApi(client).pages(WINDOW))) as { pageInfo: { newestCursor: string } }[];

    expect(MAX_PAGES).toBe(100);
    expect(queries).toHaveLength(MAX_PAGES);
    expect(seen).toHaveLength(MAX_PAGES);
    expect(seen.at(-1)?.pageInfo.newestCursor).toBe(`[${MAX_PAGES - 1},"c"]`);
  });

  it('yields the pages it read and then rejects with the failure of a later page', async () => {
    const failure = new LaunchApiError(408, [{ code: 'launch.LOGS.QUERY_TIMEOUT', message: 'slow' }]);
    const first = { serverLogs: [{ message: 'one' }], pageInfo: { hasNewer: true, newestCursor: '[1,"a"]' } };
    let calls = 0;
    const client = {
      request: async () => {
        calls += 1;
        return calls === 1 ? first : Promise.reject(failure);
      },
    } as unknown as RestApiClient;
    const seen: unknown[] = [];

    const walking = (async () => {
      for await (const page of new ServerLogsApi(client).pages(WINDOW)) {
        seen.push(page);
      }
    })();

    await expect(walking).rejects.toBe(failure);
    expect(seen).toEqual([{ logs: first.serverLogs, pageInfo: first.pageInfo }]);
    expect(calls).toBe(2);
  });

  it.each([[{}], [{ serverLogs: null }], [{ serverLogs: {} }], [null], ['text']])(
    'raises a malformed-response error when the body %j has no serverLogs array',
    async (body) => {
      const { client } = fakeRestClient(body);

      const reading = new ServerLogsApi(client).page(WINDOW);

      await expect(reading).rejects.toThrow(LaunchApiError);
      await expect(reading).rejects.toThrow('The Launch API returned a server log page without a serverLogs array.');
    },
  );

  it('propagates a failed request with its own error', async () => {
    const failure = new LaunchApiError(502, [{ code: 'launch.UPSTREAM', message: 'Bad gateway' }]);
    const client = { request: async () => Promise.reject(failure) } as unknown as RestApiClient;

    await expect(new ServerLogsApi(client).page(WINDOW)).rejects.toBe(failure);
  });
});
