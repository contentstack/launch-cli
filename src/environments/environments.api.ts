import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { ENVIRONMENT_ERROR_MESSAGES } from './environment.errors';
import { Environment, EnvironmentsPage } from './types';

export * from './types';

const MALFORMED_CODE = 'launch.RESPONSE.MALFORMED';

function malformed(message: string): LaunchApiError {
  return new LaunchApiError(200, [{ code: MALFORMED_CODE, message }]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

    if (!isRecord(response) || !Array.isArray(response.environments)) {
      throw malformed('The Launch API returned an environment list without an environments array.');
    }

    if (!isRecord(response.pagination)) {
      throw malformed('The Launch API returned an environment list without a pagination block.');
    }

    return response;
  }

  async first(params: { org: string; project: string }): Promise<Environment | undefined> {
    const page = await this.list({ ...params, limit: 1, skip: 0 });

    return page.environments[0];
  }
}
