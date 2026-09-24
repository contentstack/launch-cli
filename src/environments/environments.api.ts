import { assertPage } from '../transport/envelope';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { ENVIRONMENT_ERROR_MESSAGES } from './environment.errors';
import { Environment, EnvironmentsPage } from './types';

export * from './types';

export interface ListEnvironmentsParams {
  org: string;
  project: string;
  limit?: number;
  skip?: number;
}

export class EnvironmentsApi {
  constructor(private readonly client: RestApiClient) {}

  private request<T>(req: RestRequest): Promise<T> {
    return this.client.request<T>(req, ENVIRONMENT_ERROR_MESSAGES);
  }

  async list(params: ListEnvironmentsParams): Promise<EnvironmentsPage> {
    const response = await this.request<EnvironmentsPage>({
      method: 'GET',
      path: `/projects/${params.project}/environments`,
      orgUid: params.org,
      projectUid: params.project,
      query: { limit: params.limit, skip: params.skip },
    });

    assertPage(response, 'environments', 'an environment list');

    return response;
  }

  async first(params: { org: string; project: string }): Promise<Environment | undefined> {
    const page = await this.list({ ...params, limit: 1, skip: 0 });

    return page.environments[0];
  }
}
