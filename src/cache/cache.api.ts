import type { RestApiClient } from '../transport/rest-client';
import { CACHE_ERROR_MESSAGES, PURGE_QUOTA_CODE, asPurgeFailure } from './cache.errors';
import type { PurgeCacheParams } from './types';

export * from './types';

export class CacheApi {
  constructor(private readonly client: RestApiClient) {}

  async purge({ org, project, environment, criterion }: PurgeCacheParams): Promise<void> {
    try {
      await this.client.request<unknown>(
        {
          method: 'POST',
          path: `/projects/${project}/environments/${environment}/revalidate-cdn-cache`,
          orgUid: org,
          projectUid: project,
          body: criterion,
          noRetryCodes: [PURGE_QUOTA_CODE],
        },
        CACHE_ERROR_MESSAGES,
      );
    } catch (error) {
      throw asPurgeFailure(error);
    }
  }
}
