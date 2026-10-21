import { MALFORMED_CODE } from '../transport/envelope';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { VariablesApi } from './variables.api';

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

const TEMPLATE = [
  { keyName: 'CONTENTSTACK_API_HOST', key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' },
  { keyName: 'CONTENTSTACK_CDN', key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
  { keyName: 'CONTENTSTACK_API_KEY', key: 'CONTENTSTACK_API_KEY' },
];

describe('variables api', () => {
  it('reads the stack variable template for an organization from the CMS route and returns key and value', async () => {
    const { client, requests, messages } = fakeRestClient(TEMPLATE);

    const entries = await new VariablesApi(client).stackTemplate('org1');

    expect(requests).toEqual([{ method: 'GET', path: '/cms/environment-variables', orgUid: 'org1' }]);
    expect(messages).toHaveLength(1);
    expect(entries).toEqual([
      { key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' },
      { key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
      { key: 'CONTENTSTACK_API_KEY', value: undefined },
    ]);
  });

  it('skips an entry with no key and treats a blank or non-text value as absent', async () => {
    const { client } = fakeRestClient([
      null,
      'text',
      { value: 'orphan' },
      { key: '  ', value: 'blank key' },
      { key: 'A', value: '   ' },
      { key: 'B', value: 5 },
      { key: 'C', value: 'ok' },
    ]);

    await expect(new VariablesApi(client).stackTemplate('org1')).resolves.toEqual([
      { key: 'A', value: undefined },
      { key: 'B', value: undefined },
      { key: 'C', value: 'ok' },
    ]);
  });

  it('returns an empty template for an empty array', async () => {
    const { client } = fakeRestClient([]);

    await expect(new VariablesApi(client).stackTemplate('org1')).resolves.toEqual([]);
  });

  it.each([[undefined], [null], [{}], [{ environmentVariables: TEMPLATE }], ['text']])(
    'raises a malformed-response error when the body is not an array (%p)',
    async (body) => {
      const { client } = fakeRestClient(body);

      const error = await new VariablesApi(client).stackTemplate('org1').catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(LaunchApiError);
      expect((error as LaunchApiError).code).toBe(MALFORMED_CODE);
      expect((error as LaunchApiError).message).toBe('The Launch API returned a stack variable list that is not an array.');
    },
  );

  it('propagates a failed request', async () => {
    const failure = new Error('cms failed');
    const client = { request: async () => Promise.reject(failure) } as unknown as RestApiClient;

    await expect(new VariablesApi(client).stackTemplate('org1')).rejects.toBe(failure);
  });
});
