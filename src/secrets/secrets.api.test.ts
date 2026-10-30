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
