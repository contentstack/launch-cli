import { MAX_PAGES } from '../core/constants';
import { UsageError } from '../core/errors';
import { assertPage, isRecord, malformed, unwrap } from '../transport/envelope';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { PROJECT_ERROR_MESSAGES } from './project.errors';
import {
  CreateProjectInput,
  DetectedFramework,
  Project,
  ProjectResponse,
  ProjectUpdate,
  ProjectsPage,
  SignedUploadUrl,
} from './types';

export * from './types';

export const PROJECT_SCAN_PAGE_SIZE = 100;

function isSignedUploadUrl(value: unknown): value is SignedUploadUrl {
  return isRecord(value) && typeof value.uploadUrl === 'string' && typeof value.uploadUid === 'string';
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

export interface CreateProjectParams {
  org: string;
  input: CreateProjectInput;
}

export interface SignedUploadUrlParams {
  org: string;
}

export interface GitFrameworkParams {
  org: string;
  provider: string;
  repoName: string;
  branchName: string;
  namespace?: string;
}

export interface FileFrameworkParams {
  org: string;
  uploadUid: string;
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

    assertPage(response, 'projects', 'project list');

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

    return unwrap<Project>(response, 'project', 'project response');
  }

  async update(params: UpdateProjectParams): Promise<Project> {
    const response = await this.request<ProjectResponse>({
      method: 'PUT',
      path: `/projects/${params.project}`,
      orgUid: params.org,
      projectUid: params.project,
      body: suppliedFields(params.update),
    });

    return unwrap<Project>(response, 'project', 'project response');
  }

  async create(params: CreateProjectParams): Promise<Project> {
    const response = await this.request<ProjectResponse>({
      method: 'POST',
      path: '/projects',
      orgUid: params.org,
      body: params.input,
    });

    return unwrap<Project>(response, 'project', 'project response');
  }

  async signedUploadUrl(params: SignedUploadUrlParams): Promise<SignedUploadUrl> {
    const response = await this.request<SignedUploadUrl>({
      method: 'GET',
      path: '/projects/upload/signed_url',
      orgUid: params.org,
    });

    if (!isSignedUploadUrl(response)) {
      throw malformed('The Launch API returned an upload response without an upload URL and uid.');
    }

    return response;
  }

  gitFramework(params: GitFrameworkParams): Promise<DetectedFramework> {
    return this.framework({
      method: 'GET',
      path: '/projects/framework',
      orgUid: params.org,
      query: {
        provider: params.provider,
        repoName: params.repoName,
        branchName: params.branchName,
        namespace: params.namespace,
      },
    });
  }

  fileFramework(params: FileFrameworkParams): Promise<DetectedFramework> {
    return this.framework({
      method: 'GET',
      path: '/projects/file-framework',
      orgUid: params.org,
      query: { uploadUid: params.uploadUid },
    });
  }

  private async framework(req: RestRequest): Promise<DetectedFramework> {
    const response = await this.request<DetectedFramework>(req);

    if (!isRecord(response)) {
      throw malformed('The Launch API returned a framework response that was not an object.');
    }

    return response;
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