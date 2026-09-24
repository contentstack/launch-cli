import { assertPage, hasUid, malformed, unwrap } from '../transport/envelope';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { DEPLOYMENT_ERROR_MESSAGES } from './deployment.errors';
import { Deployment, DeploymentResponse, DeploymentsPage, IdentifiedDeployment } from './types';

export * from './types';

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

    assertPage(response, 'deployments', 'deployment list');

    return response;
  }

  async get(params: GetDeploymentParams): Promise<Deployment> {
    const response = await this.request<DeploymentResponse>({
      method: 'GET',
      path: `${DeploymentsApi.base(params)}/${params.deployment}`,
      orgUid: params.org,
      projectUid: params.project,
    });

    return unwrap<Deployment>(response, 'deployment', 'deployment response');
  }

  async latest(params: DeploymentScope): Promise<IdentifiedDeployment | undefined> {
    const page = await this.list({ ...params, limit: 1, skip: 0 });
    const [deployment] = page.deployments;

    if (deployment === undefined) {
      return undefined;
    }

    if (!hasUid(deployment)) {
      throw malformed('The Launch API returned a deployment without a deployment uid.');
    }

    return deployment;
  }
}
