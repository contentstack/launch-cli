import { randomBytes } from 'node:crypto';

import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { ENVIRONMENT_ERROR_MESSAGES } from './environment.errors';
import { EnvironmentsApi } from './environments.api';

const ORG = randomBytes(9).toString('hex');
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');

const SCOPE = { org: ORG, project: PROJECT };

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

describe('EnvironmentsApi', () => {
  it('lists environments as a project-scoped GET carrying limit and skip', async () => {
    const page = { pagination: { count: 1, limit: 10, skip: 0 }, environments: [{ uid: ENVIRONMENT, name: 'Default' }] };
    const { client, requests, messages } = fakeRestClient(page);

    const result = await new EnvironmentsApi(client).list({ ...SCOPE, limit: 10, skip: 0 });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `/projects/${PROJECT}/environments`,
      orgUid: ORG,
      projectUid: PROJECT,
      query: { limit: 10, skip: 0 },
    });
    expect(messages[0]).toBe(ENVIRONMENT_ERROR_MESSAGES);
  });

  it('raises a malformed-response error when the list has no environments array', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 10 } });

    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(LaunchApiError);
    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned an environment list without an environments array.',
    );
  });

  it('raises a malformed-response error when the list has no pagination block', async () => {
    const { client } = fakeRestClient({ environments: [] });

    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned an environment list without a pagination block.',
    );
  });

  it('raises a malformed-response error when the list body is not an object at all', async () => {
    const { client } = fakeRestClient('');

    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned an environment list without an environments array.',
    );
  });

  it('asks for one environment when it wants the first one', async () => {
    const environment = { uid: ENVIRONMENT, name: 'Default' };
    const { client, requests } = fakeRestClient({ pagination: { count: 1, limit: 1 }, environments: [environment] });

    const result = await new EnvironmentsApi(client).first(SCOPE);

    expect(result).toBe(environment);
    expect(requests[0].query).toEqual({ limit: 1, skip: 0 });
  });

  it.each([[undefined], [null], [''], ['  ']])(
    'refuses a first environment whose uid is %p rather than handing back one nothing can address',
    async (uid) => {
      const { client } = fakeRestClient({ pagination: { count: 1, limit: 1 }, environments: [{ uid, name: 'Default' }] });

      const failure = await new EnvironmentsApi(client).first(SCOPE).catch((error: Error) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as Error).message).toBe('The Launch API returned an environment without an environment uid.');
    },
  );

  it('reports no first environment when the project has none', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 1 }, environments: [] });

    await expect(new EnvironmentsApi(client).first(SCOPE)).resolves.toBeUndefined();
  });
});
