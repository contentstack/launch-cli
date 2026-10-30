import { randomBytes, randomUUID } from 'node:crypto';

import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { SECRETS_ERROR_MESSAGES } from './secrets.errors';
import { SecretsApi, secretsPath } from './secrets.api';

const ORG = randomBytes(9).toString('hex');
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');
const SCOPE = { org: ORG, project: PROJECT, environment: ENVIRONMENT };

function fakeRestClient(answer: () => Promise<unknown>) {
  const requests: RestRequest[] = [];
  const messages: unknown[] = [];
  const client = {
    request: async (req: RestRequest, errorMessages: unknown) => {
      requests.push(req);
      messages.push(errorMessages);
      return answer();
    },
  } as unknown as RestApiClient;

  return { client, requests, messages };
}

describe('secretsPath', () => {
  it('addresses the secrets of one environment', () => {
    expect(secretsPath(SCOPE)).toBe(`/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets`);
  });

  it('addresses one secret by its key and encodes the key as a single path segment', () => {
    expect(secretsPath(SCOPE, 'A/B C?d=1#e%f')).toBe(
      `/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets/A%2FB%20C%3Fd%3D1%23e%25f`,
    );
  });

  it('keeps an empty key as a segment rather than dropping it', () => {
    expect(secretsPath(SCOPE, '')).toBe(`/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets/`);
  });
});

describe('SecretsApi.list', () => {
  it('reads the secrets with a scoped GET and the secrets wording, keeping only key and updatedAt', async () => {
    const leaked = randomUUID();
    const { client, requests, messages } = fakeRestClient(async () => ({
      secrets: [
        { key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z', value: leaked, _id: 'x' },
        { key: 'DB_PASSWORD', updatedAt: '2026-09-02T10:00:00.000Z' },
      ],
      count: 2,
    }));

    const secrets = await new SecretsApi(client).list(SCOPE);

    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets`,
        orgUid: ORG,
        projectUid: PROJECT,
      },
    ]);
    expect(messages).toEqual([SECRETS_ERROR_MESSAGES]);
    expect(secrets).toEqual([
      { key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' },
      { key: 'DB_PASSWORD', updatedAt: '2026-09-02T10:00:00.000Z' },
    ]);
    expect(JSON.stringify(secrets)).not.toContain(leaked);
  });

  it('returns an empty list for a response with no secrets', async () => {
    const { client } = fakeRestClient(async () => ({ secrets: [], count: 0 }));

    await expect(new SecretsApi(client).list(SCOPE)).resolves.toEqual([]);
  });

  it.each([
    ['a key that is not text', { key: 7, updatedAt: '2026-09-01' }, { key: undefined, updatedAt: '2026-09-01' }],
    ['a blank key', { key: '  ', updatedAt: '2026-09-01' }, { key: undefined, updatedAt: '2026-09-01' }],
    ['no updatedAt', { key: 'A' }, { key: 'A', updatedAt: undefined }],
    ['an updatedAt that is not text', { key: 'A', updatedAt: 5 }, { key: 'A', updatedAt: undefined }],
    ['a blank updatedAt', { key: 'A', updatedAt: ' ' }, { key: 'A', updatedAt: undefined }],
  ])('keeps an entry with %s and leaves the missing field undefined', async (_label, entry, expected) => {
    const { client } = fakeRestClient(async () => ({ secrets: [entry], count: 1 }));

    await expect(new SecretsApi(client).list(SCOPE)).resolves.toEqual([expected]);
  });

  it.each([[null], ['text'], [3], [[]]])('drops a list entry that is not an object (%p)', async (entry) => {
    const { client } = fakeRestClient(async () => ({ secrets: [entry, { key: 'KEPT' }], count: 2 }));

    await expect(new SecretsApi(client).list(SCOPE)).resolves.toEqual([{ key: 'KEPT', updatedAt: undefined }]);
  });

  it.each([[undefined], [null], [{}], [{ secrets: null }], [{ secrets: {} }], [[]], ['text']])(
    'raises a malformed-response error when the answer has no secrets array (%p)',
    async (answer) => {
      const { client } = fakeRestClient(async () => answer);

      const failure = await new SecretsApi(client).list(SCOPE).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as LaunchApiError).message).toBe(
        'The Launch API returned a secret list without a secrets array.',
      );
    },
  );

  it.each([
    [403, 'You do not have permission to view the secrets of this environment.'],
    [404, 'The project or environment was not found.'],
    [400, 'The Launch API rejected the request to list the secrets of this environment.'],
  ])('rewords a %i from the read in read-context wording', async (status, message) => {
    const { client } = fakeRestClient(async () => {
      throw parseErrorEnvelope(status, { errors: [{ code: 'launch.X', message: 'raw text' }] }, SECRETS_ERROR_MESSAGES);
    });

    const failure = await new SecretsApi(client).list(SCOPE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect((failure as LaunchApiError).status).toBe(status);
    expect((failure as LaunchApiError).message).toBe(message);
  });

  it('lets a failure that is not an API error propagate as it is', async () => {
    const failure = new Error('socket closed');
    const { client } = fakeRestClient(async () => Promise.reject(failure));

    await expect(new SecretsApi(client).list(SCOPE)).rejects.toBe(failure);
  });
});

describe('SecretsApi.add', () => {
  it('POSTs the key and value to the collection with the scope headers and the secrets wording', async () => {
    const value = randomUUID();
    const { client, requests, messages } = fakeRestClient(async () => ({ key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' }));

    const result = await new SecretsApi(client).add({ ...SCOPE, key: 'API_TOKEN', value });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets`,
        orgUid: ORG,
        projectUid: PROJECT,
        body: { key: 'API_TOKEN', value },
      },
    ]);
    expect(messages).toEqual([SECRETS_ERROR_MESSAGES]);
    expect(result).toEqual({ key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' });
  });

  it.each([[undefined], [null], ['text'], [[]]])('answers with undefined fields when the response is not an object (%p)', async (answer) => {
    const { client } = fakeRestClient(async () => answer);

    await expect(new SecretsApi(client).add({ ...SCOPE, key: 'A', value: randomUUID() })).resolves.toEqual({
      key: undefined,
      updatedAt: undefined,
    });
  });

  it('fills a missing updatedAt with undefined and drops a value the server echoes', async () => {
    const value = randomUUID();
    const { client } = fakeRestClient(async () => ({ key: 'A', value }));

    const result = await new SecretsApi(client).add({ ...SCOPE, key: 'A', value });

    expect(result).toEqual({ key: 'A', updatedAt: undefined });
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it('words a 403 in write context and strips an echoed value from a 400', async () => {
    const value = randomUUID();
    const forbidden = fakeRestClient(async () => {
      throw parseErrorEnvelope(403, { errors: [{ code: 'launch.RBAC.FORBIDDEN' }] }, SECRETS_ERROR_MESSAGES);
    });
    const rejected = fakeRestClient(async () => {
      throw parseErrorEnvelope(400, { errors: [{ code: 'launch.X', message: `bad ${value}` }] }, SECRETS_ERROR_MESSAGES);
    });

    const first = await new SecretsApi(forbidden.client).add({ ...SCOPE, key: 'A', value }).catch((error: unknown) => error);
    const second = await new SecretsApi(rejected.client).add({ ...SCOPE, key: 'A', value }).catch((error: unknown) => error);

    expect((first as LaunchApiError).message).toBe('You do not have permission to change the secrets of this environment.');
    expect((second as LaunchApiError).message).toBe('bad ••••••');
  });
});

describe('SecretsApi.refresh', () => {
  it('PUTs only the value to the encoded key path with the scope headers', async () => {
    const value = randomUUID();
    const { client, requests, messages } = fakeRestClient(async () => ({ key: 'A/B', updatedAt: '2026-09-02T10:00:00.000Z' }));

    const result = await new SecretsApi(client).refresh({ ...SCOPE, key: 'A/B', value });

    expect(requests).toEqual([
      {
        method: 'PUT',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets/A%2FB`,
        orgUid: ORG,
        projectUid: PROJECT,
        body: { value },
      },
    ]);
    expect(messages).toEqual([SECRETS_ERROR_MESSAGES]);
    expect(result).toEqual({ key: 'A/B', updatedAt: '2026-09-02T10:00:00.000Z' });
  });

  it('answers with undefined fields when the response has no body', async () => {
    const { client } = fakeRestClient(async () => undefined);

    await expect(new SecretsApi(client).refresh({ ...SCOPE, key: 'A', value: randomUUID() })).resolves.toEqual({
      key: undefined,
      updatedAt: undefined,
    });
  });

  it('words a 404 on the key and strips an echoed value from a failure', async () => {
    const value = randomUUID();
    const missing = fakeRestClient(async () => {
      throw parseErrorEnvelope(404, { errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND' }] }, SECRETS_ERROR_MESSAGES);
    });
    const rejected = fakeRestClient(async () => {
      throw parseErrorEnvelope(400, { errors: [{ code: 'launch.X', message: `bad ${value}` }] }, SECRETS_ERROR_MESSAGES);
    });

    const first = await new SecretsApi(missing.client).refresh({ ...SCOPE, key: 'A', value }).catch((error: unknown) => error);
    const second = await new SecretsApi(rejected.client).refresh({ ...SCOPE, key: 'A', value }).catch((error: unknown) => error);

    expect((first as LaunchApiError).message).toBe('No secret with that key exists in this environment.');
    expect((second as LaunchApiError).message).toBe('bad ••••••');
  });

  it('lets a plain failure propagate with the value stripped', async () => {
    const value = randomUUID();
    const { client } = fakeRestClient(async () => Promise.reject(new Error(`x ${value}`)));

    await expect(new SecretsApi(client).refresh({ ...SCOPE, key: 'A', value })).rejects.toThrow('x ••••••');
  });
});

describe('SecretsApi.remove', () => {
  it('DELETEs the encoded key path with the scope headers, no body and the secrets wording', async () => {
    const { client, requests, messages } = fakeRestClient(async () => undefined);

    await expect(new SecretsApi(client).remove({ ...SCOPE, key: 'A/B C' })).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        method: 'DELETE',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}/secrets/A%2FB%20C`,
        orgUid: ORG,
        projectUid: PROJECT,
      },
    ]);
    expect(requests[0]).not.toHaveProperty('body');
    expect(messages).toEqual([SECRETS_ERROR_MESSAGES]);
  });

  it.each([
    [404, 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND', 'No secret with that key exists in this environment.'],
    [404, 'launch.SOMETHING.ELSE', 'The project, the environment or the secret was not found.'],
    [403, 'launch.RBAC.FORBIDDEN', 'You do not have permission to change the secrets of this environment.'],
    [
      409,
      'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE',
      "Another change to this environment's variables and secrets landed at the same moment, so nothing was changed. Run the command again.",
    ],
  ])('words a %i with code %s in write context', async (status, code, message) => {
    const { client } = fakeRestClient(async () => {
      throw parseErrorEnvelope(status, { errors: [{ code, message: 'raw' }] }, SECRETS_ERROR_MESSAGES);
    });

    const failure = await new SecretsApi(client).remove({ ...SCOPE, key: 'A' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect((failure as LaunchApiError).status).toBe(status);
    expect((failure as LaunchApiError).message).toBe(message);
  });

  it('lets a plain failure propagate with its message untouched', async () => {
    const { client } = fakeRestClient(async () => Promise.reject(new Error('socket closed')));

    await expect(new SecretsApi(client).remove({ ...SCOPE, key: 'A' })).rejects.toThrow('socket closed');
  });
});
