import { randomBytes } from 'node:crypto';

import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { DEPLOYMENT_ERROR_MESSAGES, DeploymentUnsuccessfulError } from './deployment.errors';
import { DeploymentsApi } from './deployments.api';

const ORG = randomBytes(9).toString('hex');
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');
const DEPLOYMENT = randomBytes(12).toString('hex');

const SCOPE = { org: ORG, project: PROJECT, environment: ENVIRONMENT };
const BASE = `/projects/${PROJECT}/environments/${ENVIRONMENT}/deployments`;

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

describe('DeploymentsApi', () => {
  it('lists deployments as a scoped GET carrying limit and skip', async () => {
    const page = { pagination: { count: 1, limit: 1, skip: 0 }, deployments: [{ uid: DEPLOYMENT, status: 'LIVE' }] };
    const { client, requests, messages } = fakeRestClient(page);

    const result = await new DeploymentsApi(client).list({ ...SCOPE, limit: 1, skip: 0 });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: BASE,
      orgUid: ORG,
      projectUid: PROJECT,
      query: { limit: 1, skip: 0 },
    });
    expect(messages[0]).toBe(DEPLOYMENT_ERROR_MESSAGES);
  });

  it('raises a malformed-response error when the list has no deployments array', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 1 } });

    await expect(new DeploymentsApi(client).list(SCOPE)).rejects.toThrow(LaunchApiError);
    await expect(new DeploymentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned a deployment list without a deployments array.',
    );
  });

  it('raises a malformed-response error when the list has no pagination block', async () => {
    const { client } = fakeRestClient({ deployments: [] });

    await expect(new DeploymentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned a deployment list without a pagination block.',
    );
  });

  it('raises a malformed-response error when the list body is not an object at all', async () => {
    const { client } = fakeRestClient(null);

    await expect(new DeploymentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned a deployment list without a deployments array.',
    );
  });

  it('unwraps the deployment envelope on a single get', async () => {
    const deployment = { uid: DEPLOYMENT, status: 'DEPLOYING' };
    const { client, requests } = fakeRestClient({ deployment });

    const result = await new DeploymentsApi(client).get({ ...SCOPE, deployment: DEPLOYMENT });

    expect(result).toBe(deployment);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `${BASE}/${DEPLOYMENT}`,
      orgUid: ORG,
      projectUid: PROJECT,
    });
  });

  it('raises a malformed-response error when a get returns no deployment envelope', async () => {
    const { client } = fakeRestClient({ uid: DEPLOYMENT });

    await expect(new DeploymentsApi(client).get({ ...SCOPE, deployment: DEPLOYMENT })).rejects.toThrow(
      'The Launch API returned a deployment response without a deployment.',
    );
  });

  it('raises a malformed-response error when a get returns nothing at all', async () => {
    const { client } = fakeRestClient(undefined);

    await expect(new DeploymentsApi(client).get({ ...SCOPE, deployment: DEPLOYMENT })).rejects.toThrow(
      'The Launch API returned a deployment response without a deployment.',
    );
  });

  it('asks for one deployment when it wants the latest one', async () => {
    const deployment = { uid: DEPLOYMENT, status: 'QUEUED' };
    const { client, requests } = fakeRestClient({ pagination: { count: 3, limit: 1 }, deployments: [deployment] });

    const result = await new DeploymentsApi(client).latest(SCOPE);

    expect(result).toBe(deployment);
    expect(requests[0].query).toEqual({ limit: 1, skip: 0 });
  });

  it.each([[undefined], [null], [''], ['  ']])(
    'refuses a latest deployment whose uid is %p rather than handing back one nothing can poll',
    async (uid) => {
      const { client } = fakeRestClient({ pagination: { count: 1, limit: 1 }, deployments: [{ uid, status: 'QUEUED' }] });

      const failure = await new DeploymentsApi(client).latest(SCOPE).catch((error: Error) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as Error).message).toBe('The Launch API returned a deployment without a deployment uid.');
    },
  );

  it('reports no latest deployment when the environment has none', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 1 }, deployments: [] });

    await expect(new DeploymentsApi(client).latest(SCOPE)).resolves.toBeUndefined();
  });

  it('carries exit code 1 on an unsuccessful deployment', () => {
    const error = new DeploymentUnsuccessfulError('Deployment FAILED.');

    expect(error.exitCode).toBe(1);
    expect(error.name).toBe('DeploymentUnsuccessfulError');
    expect(error.message).toBe('Deployment FAILED.');
  });
});
