import { MAX_PAGES } from '../core/constants';
import { DeploymentsApi, type GetDeploymentParams } from '../deployments/deployments.api';
import { assertArray } from '../transport/envelope';
import type { RestApiClient } from '../transport/rest-client';
import { LOGS_ERROR_MESSAGES } from './logs.errors';
import type { ServerLog, ServerLogsPage, ServerLogsResponse } from './types';

export * from './types';

export interface ServerLogsWindowParams extends GetDeploymentParams {
  startTime: number;
  endTime: number;
  search?: string;
  cursor?: string;
}

export class ServerLogsApi {
  constructor(private readonly client: RestApiClient) {}

  async window(params: ServerLogsWindowParams): Promise<ServerLog[]> {
    const response = await this.client.request<ServerLogsResponse>(
      {
        method: 'GET',
        path: `${DeploymentsApi.pathOf(params)}/logs/server-logs`,
        orgUid: params.org,
        projectUid: params.project,
        query: { startTime: params.startTime, endTime: params.endTime },
      },
      LOGS_ERROR_MESSAGES,
    );

    assertArray(response, 'serverLogs', 'server log page');

    return response.serverLogs;
  }

  async page(params: ServerLogsWindowParams): Promise<ServerLogsPage> {
    const response = await this.client.request<ServerLogsResponse>(
      {
        method: 'GET',
        path: `${DeploymentsApi.pathOf(params)}/logs/server-logs`,
        orgUid: params.org,
        projectUid: params.project,
        query: {
          startTime: params.startTime,
          endTime: params.endTime,
          sortDirection: 'asc',
          ...(params.search !== undefined && { search: params.search }),
          ...(params.cursor !== undefined && { cursor: params.cursor }),
        },
      },
      LOGS_ERROR_MESSAGES,
    );

    assertArray(response, 'serverLogs', 'server log page');

    return { logs: response.serverLogs, pageInfo: response.pageInfo };
  }

  async *pages(params: ServerLogsWindowParams): AsyncGenerator<ServerLogsPage> {
    let cursor = params.cursor;

    for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
      const page = await this.page({ ...params, cursor });

      yield page;

      const next = page.pageInfo?.newestCursor;
      const hasNext = typeof next === 'string' && next.trim() !== '';

      if (page.pageInfo?.hasNewer !== true || page.logs.length === 0 || !hasNext) {
        return;
      }

      cursor = next;
    }
  }
}
