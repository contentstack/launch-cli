import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { DEPLOYMENT_ERROR_MESSAGES } from './deployment.errors';
import { Deployment, DeploymentResponse, DeploymentsPage } from './types';

export * from './types';

const MALFORMED_CODE = 'launch.RESPONSE.MALFORMED';

function malformed(message: string): LaunchApiError {
  return new LaunchApiError(200, [{ code: MALFORMED_CODE, message }]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface DeploymentScope {
  org: string;
  project: string;
  environment: string;
}

export interface ListDeploymentsParams extends DeploymentScope {
  limit?: number;
  skip?: number;
}

export interface GetDeploymentParams extends DeploymentScope {
  deployment: string;
}

export class DeploymentsApi {
  constructor(private readonly client: RestApiClient) {}

  private request<T>(req: RestRequest): Promise<T> {
    return this.client.request<T>(req, DEPLOYMENT_ERROR_MESSAGES);
  }

  private static base(scope: DeploymentScope): string {
    return `/projects/${scope.project}/environments/${scope.environment}/deployments`;
  }

  async list(params: ListDeploymentsParams): Promise<DeploymentsPage> {
    const response = await this.request<DeploymentsPage>({
      method: 'GET',
      path: DeploymentsApi.base(params),
      orgUid: params.org,
      projectUid: params.project,
      query: { limit: params.limit, skip: params.skip },
    });

    if (!isRecord(response) || !Array.isArray(response.deployments)) {
      throw malformed('The Launch API returned a deployment list without a deployments array.');
    }

    if (!isRecord(response.pagination)) {
      throw malformed('The Launch API returned a deployment list without a pagination block.');
    }

    return response;
  }

  async get(params: GetDeploymentParams): Promise<Deployment> {
    const response = await this.request<DeploymentResponse>({
      method: 'GET',
      path: `${DeploymentsApi.base(params)}/${params.deployment}`,
      orgUid: params.org,
      projectUid: params.project,
    });

    if (!isRecord(response) || !isRecord(response.deployment)) {
      throw malformed('The Launch API returned a deployment response without a deployment.');
    }

    return response.deployment as Deployment;
  }

  async latest(params: DeploymentScope): Promise<Deployment | undefined> {
    const page = await this.list({ ...params, limit: 1, skip: 0 });

    return page.deployments[0];
  }
}
