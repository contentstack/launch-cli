import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { LaunchApiError } from '../transport/errors';
import { CacheApi } from './cache.api';
import { CACHE_ERROR_MESSAGES } from './cache.errors';

const QUOTA_CODE = 'launch.ORGANIZATION.REVALIDATE_RATE_LIMIT_EXCEEDED';

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

function purgeTags(client: RestApiClient): Promise<void> {
  return new CacheApi(client).purge({ org: 'o', project: 'p', environment: 'e', criterion: { cacheTags: ['a'] } });
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
        noRetryCodes: [QUOTA_CODE],
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

  it('rewords a 403 whatever its code as needing permission to update the environment', async () => {
    const { client } = fakeRestClient(new LaunchApiError(403, [{ code: 'launch.FORBIDDEN' }]));

    const error = await purgeTags(client).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error).toMatchObject({ status: 403, exitCode: 1 });
    expect((error as Error).message).toBe('Purging the CDN cache needs permission to update the environment.');
  });

  it.each([500, 409, 429])('rewords a %i from the purge as a failure to start the revalidation', async (status) => {
    const { client } = fakeRestClient(new LaunchApiError(status, [{ code: 'launch.OTHER', message: 'api text' }]));

    const error = await purgeTags(client).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error).toMatchObject({ status, exitCode: 1 });
    expect((error as Error).message).toBe('Failed to start cache revalidation. Try again.');
    expect((error as Error).message).not.toContain('api text');
  });
});
