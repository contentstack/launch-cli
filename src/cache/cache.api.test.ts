import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { CacheApi } from './cache.api';
import { CACHE_ERROR_MESSAGES } from './cache.errors';

function fakeRestClient(failure?: Error) {
  const requests: RestRequest[] = [];
  const messages: unknown[] = [];
  const client = {
    request: async (req: RestRequest, errorMessages: unknown) => {
      requests.push(req);
      messages.push(errorMessages);

      if (failure) {
        throw failure;
      }

      return { message: 'The CDN cache revalidation task has been initiated.' };
    },
  } as unknown as RestApiClient;

  return { client, requests, messages };
}

describe('CacheApi', () => {
  it('posts the criterion to the environment-scoped revalidate-cdn-cache route with the cache wording', async () => {
    const { client, requests, messages } = fakeRestClient();

    const result = await new CacheApi(client).purge({
      org: 'org1',
      project: 'proj1',
      environment: 'env1',
      criterion: { cacheTags: ['a'] },
    });

    expect(result).toBeUndefined();
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/projects/proj1/environments/env1/revalidate-cdn-cache',
        orgUid: 'org1',
        projectUid: 'proj1',
        body: { cacheTags: ['a'] },
      },
    ]);
    expect(messages[0]).toBe(CACHE_ERROR_MESSAGES);
  });

  it('propagates a failed request rather than reporting a purge', async () => {
    const failure = new Error('purge exploded');
    const { client } = fakeRestClient(failure);

    await expect(
      new CacheApi(client).purge({ org: 'o', project: 'p', environment: 'e', criterion: { hostnames: ['x'] } }),
    ).rejects.toBe(failure);
  });
});
