import type { Pagination } from '../core/render';
import type { ToggleValue } from '../environments/environment.inputs';
import type { CreateEnvironmentInput, EnvironmentRequest } from '../environments/types';
import type { ProjectTypeChoice } from './project.inputs';

export type { Pagination };

export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 255;

export interface ProjectRepository {
  repositoryUrl?: string;
  repositoryName?: string;
  username?: string;
  gitProvider?: string;
}

export type ProjectType = 'GITPROVIDER' | 'FILEUPLOAD';

export interface Project {
  uid?: string;
  name?: string;
  description?: string;
  projectType?: ProjectType;
  repository?: ProjectRepository;
  organizationUid?: string;
  cmsStackApiKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  createdBy?: string;
  updatedBy?: string;
  deletedBy?: string | null;
}

export type IdentifiedProject = Project & { uid: string };

export interface ProjectUpdate {
  name?: string;
  description?: string;
}

export interface GitProviderMetadataInput {
  gitProvider: string;
}

export interface RepositoryInput {
  repositoryName: string;
  username: string;
  repositoryUrl: string;
  gitProviderMetadata: GitProviderMetadataInput;
}

export interface FileUploadInput {
  uploadUid: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  projectType: ProjectType;
  environment: CreateEnvironmentInput;
  repository?: RepositoryInput;
  fileUpload?: FileUploadInput;
}

export interface ProjectResponse {
  project: Project;
}

export interface ProjectsPage {
  pagination: Pagination;
  projects: Project[];
}

export interface CreateRequest extends EnvironmentRequest {
  org: string;
  dataDir: string;
  configPath: string;
  type?: ProjectTypeChoice;
  name?: string;
  description?: string;
  envName?: string;
  branch?: string;
  autoDeploy?: ToggleValue;
}
