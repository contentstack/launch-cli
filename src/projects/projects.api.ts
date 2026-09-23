import { MAX_PAGES } from '../core/constants';
import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { PROJECT_ERROR_MESSAGES } from './project.errors';
import { Project, ProjectResponse, ProjectUpdate, ProjectsPage } from './types';

export * from './types';

export const PROJECT_SCAN_PAGE_SIZE = 100;

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

export interface PageProjectsParams {
  org: string;
  pageSize?: number;
}

export interface GetProjectParams {
  org: string;
  project: string;
}

export interface DeleteProjectParams {
  org: string;
  project: string;
}

export interface UpdateProjectParams {
  org: string;
  project: string;
  update: ProjectUpdate;
}

function suppliedFields(update: ProjectUpdate): ProjectUpdate {
  const body: ProjectUpdate = {};

  for (const [field, value] of Object.entries(update) as [keyof ProjectUpdate, string | undefined][]) {
    if (value !== undefined) {
      body[field] = value;
    }
  }

  return body;
}

export class ProjectScanLimitError extends UsageError {
  constructor() {
    super(
      `Stopped after scanning ${MAX_PAGES} pages of projects without reaching the end of the organization. ` +
        'Pass --project with the project uid instead of its name.',
    );
    this.name = 'ProjectScanLimitError';
  }
}

export class ProjectsApi {
  constructor(private readonly client: RestApiClient) {}

  private request<T>(req: RestRequest): Promise<T> {
    return this.client.request<T>(req, PROJECT_ERROR_MESSAGES);
  }

  async list(params: ListProjectsParams): Promise<ProjectsPage> {
    const response = await this.request<ProjectsPage>({
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

  async *pages(params: PageProjectsParams): AsyncGenerator<ProjectsPage> {
    const limit = params.pageSize ?? PROJECT_SCAN_PAGE_SIZE;
    let skip = 0;

    for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
      const page = await this.list({ org: params.org, limit, skip });

      if (page.projects.length === 0) {
        return;
      }

      yield page;

      if (page.projects.length < limit) {
        return;
      }

      skip += page.projects.length;

      if (skip >= page.pagination.count) {
        return;
      }
    }

    throw new ProjectScanLimitError();
  }

  async get(params: GetProjectParams): Promise<Project> {
    const response = await this.request<ProjectResponse>({
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

  async update(params: UpdateProjectParams): Promise<Project> {
    const response = await this.request<ProjectResponse>({
      method: 'PUT',
      path: `/projects/${params.project}`,
      orgUid: params.org,
      projectUid: params.project,
      body: suppliedFields(params.update),
    });

    if (!isRecord(response) || !isRecord(response.project)) {
      throw malformed('The Launch API returned a project response without a project.');
    }

    return response.project as Project;
  }

  async delete(params: DeleteProjectParams): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/projects/${params.project}`,
      orgUid: params.org,
      projectUid: params.project,
    });
  }
}