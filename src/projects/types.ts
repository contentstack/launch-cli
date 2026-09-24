import type { Pagination } from '../core/render';
import type { CreateEnvironmentInput } from '../environments/types';

export type { Pagination };

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

export interface DetectedFramework {
  framework?: string;
  outputDirectory?: string;
  serverCommand?: string;
  buildCommand?: string;
}

export interface SignedUploadField {
  key?: string;
  value?: string;
}

export interface SignedUploadUrl {
  uploadUrl: string;
  uploadUid: string;
  method?: string;
  expiresIn?: number;
  fields?: SignedUploadField[];
  headers?: SignedUploadField[];
}

export interface ProjectResponse {
  project: Project;
}

export interface ProjectsPage {
  pagination: Pagination;
  projects: Project[];
}
