import { randomBytes } from 'node:crypto';

import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { DEPLOYMENT_ERROR_MESSAGES } from './deployment.errors';
import { DeploymentLogsApi } from './deployment-logs.api';

const ORG = randomBytes(9).toString('hex');
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');
const DEPLOYMENT = randomBytes(12).toString('hex');

const SCOPE = { org: ORG, project: PROJECT, environment: ENVIRONMENT, deployment: DEPLOYMENT };

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

describe('DeploymentLogsApi', () => {
  it('reads the logs after a timestamp as a scoped GET and returns them in order', async () => {
    const logs = [
      { message: 'Installing dependencies...', timestamp: '2026-09-25T10:00:00.000Z', stage: 'INSTALL' },
      { message: 'Build complete', timestamp: '2026-09-25T10:00:05.000Z', stage: 'BUILD' },
    ];
    const { client, requests, messages } = fakeRestClient({ deploymentLogs: logs });

    const result = await new DeploymentLogsApi(client).after({ ...SCOPE, timestamp: '2026-09-25T09:59:59.000Z' });

    expect(result).toEqual(logs);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/deployments/${DEPLOYMENT}/logs/deployment-logs`,
      orgUid: ORG,
      projectUid: PROJECT,
      query: { timestamp: '2026-09-25T09:59:59.000Z' },
    });
    expect(messages[0]).toBe(DEPLOYMENT_ERROR_MESSAGES);
  });

  it.each([[{}], [{ deploymentLogs: null }], [null]])(
    'raises a malformed-response error when the body %j has no deploymentLogs array',
    async (body) => {
      const { client } = fakeRestClient(body);

      const reading = new DeploymentLogsApi(client).after({ ...SCOPE, timestamp: '2026-09-25T09:59:59.000Z' });

      await expect(reading).rejects.toThrow(LaunchApiError);
      await expect(reading).rejects.toThrow(
        'The Launch API returned a deployment log page without a deploymentLogs array.',
      );
    },
  );

  it('propagates a failed request with its own error', async () => {
    const failure = new LaunchApiError(502, [{ code: 'launch.UPSTREAM', message: 'Bad gateway' }]);
    const client = { request: async () => Promise.reject(failure) } as unknown as RestApiClient;

    await expect(
      new DeploymentLogsApi(client).after({ ...SCOPE, timestamp: '2026-09-25T09:59:59.000Z' }),
    ).rejects.toBe(failure);
  });
});
