import { RestApiClient } from '../http/rest-client';
import { Project, ProjectResponse, ProjectsPage } from './types';

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

  list(params: ListProjectsParams): Promise<ProjectsPage> {
    return this.client.request<ProjectsPage>({
      method: 'GET',
      path: '/projects',
      orgUid: params.org,
      query: { limit: params.limit, skip: params.skip },
    });
  }

  async get(params: GetProjectParams): Promise<Project> {
    const response = await this.client.request<ProjectResponse>({
      method: 'GET',
      path: `/projects/${params.project}`,
      orgUid: params.org,
      projectUid: params.project,
    });

    return response.project;
  }
}
