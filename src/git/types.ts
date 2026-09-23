import type { Pagination } from '../core/render';

export type { Pagination };

export const GIT_PROVIDER_GITHUB = 'GitHub';

export interface GitNamespace {
  name?: string;
  type?: string;
  provider?: string;
  appName?: string;
}

export interface GitRepository {
  id?: string;
  name?: string;
  fullName?: string;
  url?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
}

export interface GitBranch {
  name?: string;
}

export interface GitNamespacesPage {
  pagination: Pagination;
  namespaces: GitNamespace[];
}

export interface GitRepositoriesPage {
  pagination: Pagination;
  repositories: GitRepository[];
}

export interface GitBranchesPage {
  pagination: Pagination;
  branches: GitBranch[];
}
