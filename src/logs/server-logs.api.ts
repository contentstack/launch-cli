import { DeploymentsApi, type GetDeploymentParams } from '../deployments/deployments.api';
import { assertArray } from '../transport/envelope';
import type { RestApiClient } from '../transport/rest-client';
import { LOGS_ERROR_MESSAGES } from './logs.errors';
import type { ServerLog, ServerLogsResponse } from './types';

export * from './types';

export interface ServerLogsWindowParams extends GetDeploymentParams {
  startTime: number;
  endTime: number;
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
}
