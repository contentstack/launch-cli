import { randomBytes } from 'node:crypto';

import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import {
  CANCEL_NOT_ALLOWED_RAW_MESSAGE,
  DEPLOYMENT_ERROR_MESSAGES,
  DeploymentUnsuccessfulError,
} from './deployment.errors';
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

  it.each([
    ['the branch tip', {}, { environment: ENVIRONMENT }],
    ['a commit', { commitHash: 'abc123' }, { environment: ENVIRONMENT, commitHash: 'abc123' }],
    ['an upload', { uploadUid: 'up-1' }, { environment: ENVIRONMENT, uploadUid: 'up-1' }],
  ])('creates %s with a POST of exactly the given body, scoped to the org and project, and returns the new uid', async (_label, extra, body) => {
    const created = { uid: DEPLOYMENT, status: 'QUEUED' };
    const { client, requests, messages } = fakeRestClient({ deployment: created });

    const result = await new DeploymentsApi(client).create({ ...SCOPE, ...extra });

    expect(result).toBe(created);
    expect(requests).toEqual([{ method: 'POST', path: BASE, orgUid: ORG, projectUid: PROJECT, body }]);
    expect(messages[0]).toBe(DEPLOYMENT_ERROR_MESSAGES);
  });

  it('leaves commitHash and uploadUid out of the body when they are undefined', async () => {
    const { client, requests } = fakeRestClient({ deployment: { uid: DEPLOYMENT } });

    await new DeploymentsApi(client).create({ ...SCOPE, commitHash: undefined, uploadUid: undefined });

    expect(Object.keys(requests[0].body as object)).toEqual(['environment']);
  });

  it.each([[undefined], [null], [''], ['  ']])(
    'raises a malformed-response error when the created deployment has uid %p',
    async (uid) => {
      const { client } = fakeRestClient({ deployment: { uid, status: 'QUEUED' } });

      const failure = await new DeploymentsApi(client).create(SCOPE).catch((error: Error) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as Error).message).toBe('The Launch API returned a deployment without a deployment uid.');
    },
  );

  it('raises a malformed-response error when the create response has no deployment', async () => {
    const { client } = fakeRestClient({ uid: DEPLOYMENT });

    const failure = await new DeploymentsApi(client).create(SCOPE).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect((failure as Error).message).toBe('The Launch API returned a deployment response without a deployment.');
  });

  it('propagates a rejected create unchanged', async () => {
    const rejection = new LaunchApiError(500, [{ code: 'launch.DEPLOYMENT.CREATE_FAILED', message: 'x' }]);
    const client = { request: async () => Promise.reject(rejection) } as unknown as RestApiClient;

    await expect(new DeploymentsApi(client).create(SCOPE)).rejects.toBe(rejection);
  });

  it('carries exit code 1 on an unsuccessful deployment', () => {
    const error = new DeploymentUnsuccessfulError('Deployment FAILED.');

    expect(error.exitCode).toBe(1);
    expect(error.name).toBe('DeploymentUnsuccessfulError');
    expect(error.message).toBe('Deployment FAILED.');
  });

  it('posts the rollback body with the trimmed reason and the deployment scope', async () => {
    const { client, requests, messages } = fakeRestClient({});

    await new DeploymentsApi(client).rollback({ ...SCOPE, deployment: DEPLOYMENT, reason: '  bad release  ' });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: `${BASE}/rollback`,
        orgUid: ORG,
        projectUid: PROJECT,
        body: { deployment: DEPLOYMENT, environment: ENVIRONMENT, reason: 'bad release' },
      },
    ]);
    expect(messages[0]).toBe(DEPLOYMENT_ERROR_MESSAGES);
  });

  it.each([[undefined], [''], ['   ']])('leaves the reason out of the rollback body for %j', async (reason) => {
    const { client, requests } = fakeRestClient({});

    await new DeploymentsApi(client).rollback({ ...SCOPE, deployment: DEPLOYMENT, reason });

    expect(requests[0].body).toEqual({ deployment: DEPLOYMENT, environment: ENVIRONMENT });
    expect(Object.keys(requests[0].body as object)).toEqual(['deployment', 'environment']);
  });

  it.each([
    ['launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE', 409],
    ['launch.DEPLOYMENT.NO_LIVE_DEPLOYMENT_FOUND', 409],
    ['launch.DEPLOYMENT.NOT_FOUND', 404],
    ['launch.DEPLOYMENT.ROLLBACK_INVALID_STATUS', 400],
    ['launch.DEPLOYMENT.ROLLBACK_TO_CURRENT_DEPLOYMENT', 400],
    ['launch.DEPLOYMENT.ROLLBACK_FAILED', 500],
  ])('words the rollback refusal %s in the CLI own words', (code, status) => {
    const failure = new LaunchApiError(status, [{ code, message: 'raw' }], DEPLOYMENT_ERROR_MESSAGES);

    expect(failure.exitCode).toBe(1);
    expect(failure.message).not.toBe(code);
    expect(failure.message).not.toBe('raw');
    expect(failure.message).toBe(DEPLOYMENT_ERROR_MESSAGES[code]);
  });

  it('gives the rollback refusals three distinct messages', () => {
    const messages = [
      'launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE',
      'launch.DEPLOYMENT.NO_LIVE_DEPLOYMENT_FOUND',
      'launch.DEPLOYMENT.NOT_FOUND',
    ].map((code) => DEPLOYMENT_ERROR_MESSAGES[code]);

    expect(new Set(messages).size).toBe(3);
  });

  it('propagates a rejected rollback unchanged', async () => {
    const rejection = new LaunchApiError(409, [{ code: 'launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE', message: 'x' }]);
    const client = { request: async () => Promise.reject(rejection) } as unknown as RestApiClient;

    await expect(new DeploymentsApi(client).rollback({ ...SCOPE, deployment: DEPLOYMENT })).rejects.toBe(rejection);
  });

  it('posts a bodyless cancel to the deployment cancel path', async () => {
    const { client, requests, messages } = fakeRestClient({});

    await new DeploymentsApi(client).cancel({ ...SCOPE, deployment: DEPLOYMENT });

    expect(requests).toEqual([
      { method: 'POST', path: `${BASE}/${DEPLOYMENT}/cancel`, orgUid: ORG, projectUid: PROJECT },
    ]);
    expect('body' in requests[0]).toBe(false);
    expect(messages[0]).toBe(DEPLOYMENT_ERROR_MESSAGES);
  });

  it.each([
    ['the code', [{ code: 'launch.DEPLOYMENT.CANCEL_NOT_ALLOWED', message: 'x' }]],
    ['the raw message as the code', [{ code: CANCEL_NOT_ALLOWED_RAW_MESSAGE, message: CANCEL_NOT_ALLOWED_RAW_MESSAGE }]],
    ['the raw message alone', [{ message: CANCEL_NOT_ALLOWED_RAW_MESSAGE }]],
  ])('words a cancel refused with %s as the cancel-not-allowed message', async (_name, errors) => {
    const rejection = new LaunchApiError(400, errors, DEPLOYMENT_ERROR_MESSAGES);
    const client = { request: async () => Promise.reject(rejection) } as unknown as RestApiClient;

    const failure = (await new DeploymentsApi(client)
      .cancel({ ...SCOPE, deployment: DEPLOYMENT })
      .catch((error: unknown) => error)) as LaunchApiError;

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect(failure.exitCode).toBe(1);
    expect(failure.status).toBe(400);
    expect(failure.code).toBe('launch.DEPLOYMENT.CANCEL_NOT_ALLOWED');
    expect(failure.message).toBe(DEPLOYMENT_ERROR_MESSAGES['launch.DEPLOYMENT.CANCEL_NOT_ALLOWED']);
    expect(failure.message).not.toBe(CANCEL_NOT_ALLOWED_RAW_MESSAGE);
  });

  it('leaves a 400 with another message, and a non-400 with the raw message, untouched on cancel', async () => {
    const other = new LaunchApiError(400, [{ message: 'something else' }]);
    const wrongStatus = new LaunchApiError(409, [{ message: CANCEL_NOT_ALLOWED_RAW_MESSAGE }]);
    const notFound = new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'x' }], DEPLOYMENT_ERROR_MESSAGES);
    const plain = new Error('boom');

    for (const rejection of [other, wrongStatus, notFound, plain]) {
      const client = { request: async () => Promise.reject(rejection) } as unknown as RestApiClient;

      await expect(new DeploymentsApi(client).cancel({ ...SCOPE, deployment: DEPLOYMENT })).rejects.toBe(rejection);
    }

    expect(notFound.message).toBe('No deployment found with that UID.');
  });
});
