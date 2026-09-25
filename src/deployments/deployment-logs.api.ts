import { assertArray } from '../transport/envelope';
import { RestApiClient } from '../transport/rest-client';
import { DEPLOYMENT_ERROR_MESSAGES } from './deployment.errors';
import { DeploymentsApi, type GetDeploymentParams } from './deployments.api';
import type { DeploymentLog } from './types';

export interface DeploymentLogsAfterParams extends GetDeploymentParams {
  timestamp: string;
}

interface DeploymentLogsResponse {
  deploymentLogs: DeploymentLog[];
}

export class DeploymentLogsApi {
  constructor(private readonly client: RestApiClient) {}

  async after(params: DeploymentLogsAfterParams): Promise<DeploymentLog[]> {
    const response = await this.client.request<DeploymentLogsResponse>(
      {
        method: 'GET',
        path: `${DeploymentsApi.pathOf(params)}/logs/deployment-logs`,
        orgUid: params.org,
        projectUid: params.project,
        query: { timestamp: params.timestamp },
      },
      DEPLOYMENT_ERROR_MESSAGES,
    );

    assertArray(response, 'deploymentLogs', 'deployment log page');

    return response.deploymentLogs;
  }
}
