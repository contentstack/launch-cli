import { MALFORMED_CODE } from '../transport/envelope';
import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { VariablesApi } from './variables.api';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const PATCH_PATH = '/projects/proj1/environments/env1/variables';

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

  it('patches the variables of one environment, sending only the keys to set and to unset', async () => {
    const { client, requests } = fakeRestClient({ environment: { uid: 'env1', environmentVariables: [{ key: 'A' }] } });
    const api = new VariablesApi(client);

    await api.patch({ ...SCOPE, set: [{ key: 'A', value: '1' }] });
    await api.patch({ ...SCOPE, unset: ['B'] });
    await api.patch({ ...SCOPE, set: [{ key: 'A', value: '1' }], unset: ['B'] });

    expect(requests).toEqual([
      { method: 'PATCH', path: PATCH_PATH, orgUid: 'org1', projectUid: 'proj1', body: { set: [{ key: 'A', value: '1' }] } },
      { method: 'PATCH', path: PATCH_PATH, orgUid: 'org1', projectUid: 'proj1', body: { unset: ['B'] } },
      {
        method: 'PATCH',
        path: PATCH_PATH,
        orgUid: 'org1',
        projectUid: 'proj1',
        body: { set: [{ key: 'A', value: '1' }], unset: ['B'] },
      },
    ]);
  });

  it.each([
    [['A'], 'A is not set in this environment.'],
    [['A', 'B'], 'At least one of A, B is not set in this environment.'],
  ])('words a 404 for a key that is not set as a usage error naming the keys asked for (%p)', async (unset, message) => {
    const notSet = new LaunchApiError(404, [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_FOUND' }]);
    const client = { request: async () => Promise.reject(notSet) } as unknown as RestApiClient;

    const error = await new VariablesApi(client).patch({ ...SCOPE, unset }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toBe(message);
  });

  it.each([
    [400, 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.PATCH_EMPTY'],
    [400, 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONFLICTING_KEYS'],
  ])('says an unreachable patch rejection is an internal error (%p %s)', async (status, code) => {
    const { client, messages } = fakeRestClient({});

    await new VariablesApi(client).patch({ ...SCOPE, unset: ['A'] });

    const rejection = new LaunchApiError(status, [{ code }], messages[0] as Record<string, string>);

    expect(rejection.message).toBe('The CLI sent an update the Launch API could not accept. This is a bug in the CLI.');
  });

  it('tells the user to run the command again when another writer changed the variables first', async () => {
    const { client, messages } = fakeRestClient({});

    await new VariablesApi(client).patch({ ...SCOPE, unset: ['A'] });

    const conflict = new LaunchApiError(
      409,
      [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE' }],
      messages[0] as Record<string, string>,
    );

    expect(conflict.message).toBe(
      "Another change to this environment's variables landed at the same moment, so nothing was changed. Run the command again.",
    );
  });

  it('rethrows any other failure of the patch untouched', async () => {
    const failure = new LaunchApiError(500, [{ code: 'launch.ENVIRONMENT.UPDATE_FAILED' }]);
    const client = { request: async () => Promise.reject(failure) } as unknown as RestApiClient;

    await expect(new VariablesApi(client).patch({ ...SCOPE, unset: ['A'] })).rejects.toBe(failure);
  });

  it('leaves a 404 for a key that is not set untouched when the patch had no keys to unset', async () => {
    const notSet = new LaunchApiError(404, [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_FOUND' }]);
    const client = { request: async () => Promise.reject(notSet) } as unknown as RestApiClient;

    await expect(new VariablesApi(client).patch({ ...SCOPE, set: [{ key: 'A', value: '1' }] })).rejects.toBe(notSet);
  });
});
