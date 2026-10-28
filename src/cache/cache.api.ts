import type { RestApiClient } from '../transport/rest-client';
import { CACHE_ERROR_MESSAGES } from './cache.errors';
import type { PurgeCacheParams } from './types';

export * from './types';

export class CacheApi {
  constructor(private readonly client: RestApiClient) {}

  async purge({ org, project, environment, criterion }: PurgeCacheParams): Promise<void> {
    await this.client.request<unknown>(
      {
        method: 'POST',
        path: `/projects/${project}/environments/${environment}/revalidate-cdn-cache`,
        orgUid: org,
        projectUid: project,
        body: criterion,
      },
      CACHE_ERROR_MESSAGES,
    );
  }
}
