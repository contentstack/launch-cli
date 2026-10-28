import { assertPage, hasUid, malformed, unwrap } from '../transport/envelope';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { DEPLOYMENT_ERROR_MESSAGES } from './deployment.errors';
import type { Deployment, DeploymentResponse, DeploymentsPage, IdentifiedDeployment } from './types';

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

export interface CreateDeploymentParams extends DeploymentScope {
  commitHash?: string;
  uploadUid?: string;
}

export interface RollbackDeploymentParams extends DeploymentScope {
  deployment: string;
  reason?: string;
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

  static pathOf(params: GetDeploymentParams): string {
    return `${DeploymentsApi.base(params)}/${params.deployment}`;
  }

  async get(params: GetDeploymentParams): Promise<Deployment> {
    const response = await this.request<DeploymentResponse>({
      method: 'GET',
      path: DeploymentsApi.pathOf(params),
      orgUid: params.org,
      projectUid: params.project,
    });

    return unwrap<Deployment>(response, 'deployment', 'deployment response');
  }

  async create(params: CreateDeploymentParams): Promise<IdentifiedDeployment> {
    const body: { environment: string; commitHash?: string; uploadUid?: string } = { environment: params.environment };

    if (params.commitHash !== undefined) {
      body.commitHash = params.commitHash;
    }

    if (params.uploadUid !== undefined) {
      body.uploadUid = params.uploadUid;
    }

    const response = await this.request<DeploymentResponse>({
      method: 'POST',
      path: DeploymentsApi.base(params),
      orgUid: params.org,
      projectUid: params.project,
      body,
    });
    const deployment = unwrap<Deployment>(response, 'deployment', 'deployment response');

    if (!hasUid(deployment)) {
      throw malformed('The Launch API returned a deployment without a deployment uid.');
    }

    return deployment;
  }

  async rollback(params: RollbackDeploymentParams): Promise<void> {
    const body: { deployment: string; environment: string; reason?: string } = {
      deployment: params.deployment,
      environment: params.environment,
    };
    const reason = params.reason?.trim();

    if (reason !== undefined && reason !== '') {
      body.reason = reason;
    }

    await this.request<unknown>({
      method: 'POST',
      path: `${DeploymentsApi.base(params)}/rollback`,
      orgUid: params.org,
      projectUid: params.project,
      body,
    });
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
