import { randomBytes } from 'node:crypto';

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

describe('ServerLogsApi', () => {
  it('reads the window as a scoped GET on the deployment path and returns the entries in order', async () => {
    const entries = [
      { timestamp: '2026-10-28T10:00:00.000Z', message: 'first', source: 'edge' },
      { timestamp: '2026-10-28T10:00:01.000Z', message: 'second', source: 'edge' },
    ];
    const { client, requests, messages } = fakeRestClient({ serverLogs: entries });

    const result = await new ServerLogsApi(client).window(WINDOW);

    expect(result).toEqual(entries);
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/deployments/${DEPLOYMENT}/logs/server-logs`,
        orgUid: ORG,
        projectUid: PROJECT,
        query: { startTime: 1_000, endTime: 2_000 },
      },
    ]);
    expect(messages[0]).toBe(LOGS_ERROR_MESSAGES);
  });

  it('returns an empty page as an empty list', async () => {
    const { client } = fakeRestClient({ serverLogs: [] });

    await expect(new ServerLogsApi(client).window(WINDOW)).resolves.toEqual([]);
  });

  it.each([[{}], [{ serverLogs: null }], [{ serverLogs: {} }], [null], ['text']])(
    'raises a malformed-response error when the body %j has no serverLogs array',
    async (body) => {
      const { client } = fakeRestClient(body);

      const reading = new ServerLogsApi(client).window(WINDOW);

      await expect(reading).rejects.toThrow(LaunchApiError);
      await expect(reading).rejects.toThrow('The Launch API returned a server log page without a serverLogs array.');
    },
  );

  it('propagates a failed request with its own error', async () => {
    const failure = new LaunchApiError(502, [{ code: 'launch.UPSTREAM', message: 'Bad gateway' }]);
    const client = { request: async () => Promise.reject(failure) } as unknown as RestApiClient;

    await expect(new ServerLogsApi(client).window(WINDOW)).rejects.toBe(failure);
  });
});
