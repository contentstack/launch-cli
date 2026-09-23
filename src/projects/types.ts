export interface Pagination {
  count: number;
  limit: number;
  skip?: number | null;
}

export interface ProjectRepository {
  repositoryUrl?: string;
  repositoryName?: string;
  username?: string;
  gitProvider?: string;
}

export type ProjectType = 'GITPROVIDER' | 'FILEUPLOAD';

export interface Project {
  uid: string;
  name: string;
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

export interface ProjectResponse {
  project: Project;
}

export interface ProjectsPage {
  pagination: Pagination;
  projects: Project[];
}
