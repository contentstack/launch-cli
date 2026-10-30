import { randomUUID } from 'node:crypto';

import { MALFORMED_CODE } from '../transport/envelope';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { SECRETS_ERROR_MESSAGES } from './secrets.errors';
import { SecretsApi } from './secrets.api';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const LIST_PATH = '/projects/proj1/environments/env1/secrets';

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

function failingRestClient(failure: unknown) {
  return {
    request: async () => Promise.reject(failure),
  } as unknown as RestApiClient;
}

describe('secrets api list', () => {
  it('reads the secrets of the environment with its scope headers and the secrets wording', async () => {
    const { client, requests, messages } = fakeRestClient({
      secrets: [{ key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' }],
      count: 1,
    });

    const secrets = await new SecretsApi(client).list(SCOPE);

    expect(requests).toEqual([{ method: 'GET', path: LIST_PATH, orgUid: 'org1', projectUid: 'proj1' }]);
    expect(messages).toEqual([SECRETS_ERROR_MESSAGES]);
    expect(secrets).toEqual([{ key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' }]);
  });

  it('keeps only the key and update time of an entry, so a value in the body never leaves the repository', async () => {
    const value = randomUUID();
    const { client } = fakeRestClient({
      secrets: [{ key: 'API_TOKEN', updatedAt: '2026-09-01', value, encryptedValue: value }],
    });

    const secrets = await new SecretsApi(client).list(SCOPE);

    expect(secrets).toEqual([{ key: 'API_TOKEN', updatedAt: '2026-09-01' }]);
    expect(JSON.stringify(secrets)).not.toContain(value);
  });

  it('returns an empty list for an environment with no secrets', async () => {
    const { client } = fakeRestClient({ secrets: [], count: 0 });

    await expect(new SecretsApi(client).list(SCOPE)).resolves.toEqual([]);
  });

  it('drops entries that are not objects and a key or time that is not text', async () => {
    const { client } = fakeRestClient({
      secrets: [null, 'text', 5, [], { key: 7, updatedAt: false }, { key: 'A' }, { updatedAt: '2026-09-01' }],
    });

    await expect(new SecretsApi(client).list(SCOPE)).resolves.toEqual([
      { key: undefined, updatedAt: undefined },
      { key: 'A', updatedAt: undefined },
      { key: undefined, updatedAt: '2026-09-01' },
    ]);
  });

  it.each([[undefined], [null], [{}], [{ secrets: 'A' }], [{ secrets: { key: 'A' } }], [[{ key: 'A' }]]])(
    'raises a malformed-response error when the body has no secrets array (%p)',
    async (body) => {
      const { client } = fakeRestClient(body);

      const failure = await new SecretsApi(client).list(SCOPE).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as LaunchApiError).code).toBe(MALFORMED_CODE);
      expect((failure as LaunchApiError).message).toBe('The Launch API returned a secret list without a secrets array.');
    },
  );

  it('rewords any 403 as the permission message whatever code the service sent', async () => {
    const forbidden = new LaunchApiError(403, [{ code: 'launch.SOMETHING', message: 'raw server text' }]);

    const failure = await new SecretsApi(failingRestClient(forbidden)).list(SCOPE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect((failure as LaunchApiError).status).toBe(403);
    expect((failure as LaunchApiError).message).toBe(
      'You do not have permission to manage the secrets of this environment.',
    );
  });

  it('passes any other API error through unchanged', async () => {
    const missing = new LaunchApiError(404, [{ code: 'launch.ENVIRONMENT.NOT_FOUND', message: 'Environment not found.' }]);

    const failure = await new SecretsApi(failingRestClient(missing)).list(SCOPE).catch((error: unknown) => error);

    expect(failure).toBe(missing);
  });

  it('passes a failure that is not an API error through unchanged', async () => {
    const network = new Error('socket hang up');

    const failure = await new SecretsApi(failingRestClient(network)).list(SCOPE).catch((error: unknown) => error);

    expect(failure).toBe(network);
  });
});
