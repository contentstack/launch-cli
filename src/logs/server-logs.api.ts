import { MAX_PAGES } from '../core/constants';
import { DeploymentsApi, type GetDeploymentParams } from '../deployments/deployments.api';
import { isRecord } from '../core/values';
import { assertArray, malformed } from '../transport/envelope';
import type { RestApiClient } from '../transport/rest-client';
import { LOGS_ERROR_MESSAGES } from './logs.errors';
import type { ServerLogsPage, ServerLogsResponse } from './types';

export * from './types';

export interface ServerLogsWindowParams extends GetDeploymentParams {
  startTime: number;
  endTime: number;
  search?: string;
  cursor?: string;
}

export function nextCursorOf(page: ServerLogsPage): string | undefined {
  const next = page.pageInfo?.newestCursor;
  const hasNext = typeof next === 'string' && next.trim() !== '';

  return page.pageInfo?.hasNewer === true && page.logs.length > 0 && hasNext ? next : undefined;
}

export class ServerLogsApi {
  constructor(private readonly client: RestApiClient) {}

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

    if ((params.search !== undefined || params.cursor !== undefined) && !isRecord(response.pageInfo)) {
      throw malformed(
        'The Launch API in this region does not support --search or --cursor for server logs yet. ' +
          'Run the command without them.',
      );
    }

    return { logs: response.serverLogs, pageInfo: response.pageInfo };
  }

  async *pages(params: ServerLogsWindowParams): AsyncGenerator<ServerLogsPage> {
    let cursor = params.cursor;

    for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
      const page = await this.page({ ...params, cursor });

      yield page;

      cursor = nextCursorOf(page);

      if (cursor === undefined) {
        return;
      }
    }
  }
}
