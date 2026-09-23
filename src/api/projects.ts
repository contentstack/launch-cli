import { LaunchApiError } from '../http/errors';
import { RestApiClient } from '../http/rest-client';
import { Project, ProjectResponse, ProjectsPage } from './types';

const MALFORMED_CODE = 'launch.RESPONSE.MALFORMED';

function malformed(message: string): LaunchApiError {
  return new LaunchApiError(200, [{ code: MALFORMED_CODE, message }]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ListProjectsParams {
  org: string;
  limit?: number;
  skip?: number;
}

export interface GetProjectParams {
  org: string;
  project: string;
}

export class ProjectsApi {
  constructor(private readonly client: RestApiClient) {}

  async list(params: ListProjectsParams): Promise<ProjectsPage> {
    const response = await this.client.request<ProjectsPage>({
      method: 'GET',
      path: '/projects',
      orgUid: params.org,
      query: { limit: params.limit, skip: params.skip },
    });

    if (!isRecord(response) || !Array.isArray(response.projects)) {
      throw malformed('The Launch API returned a project list without a projects array.');
    }

    if (!isRecord(response.pagination)) {
      throw malformed('The Launch API returned a project list without a pagination block.');
    }

    return response;
  }

  async get(params: GetProjectParams): Promise<Project> {
    const response = await this.client.request<ProjectResponse>({
      method: 'GET',
      path: `/projects/${params.project}`,
      orgUid: params.org,
      projectUid: params.project,
    });

    if (!isRecord(response) || !isRecord(response.project)) {
      throw malformed('The Launch API returned a project response without a project.');
    }

    return response.project as Project;
  }
}
