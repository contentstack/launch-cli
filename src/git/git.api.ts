import { assertArray } from '../transport/envelope';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { GIT_ERROR_MESSAGES } from './git.errors';
import { GitBranchesPage, GitNamespacesPage, GitRepositoriesPage } from './types';

export * from './types';

export interface GitPageParams {
  org: string;
  limit?: number;
  skip?: number;
}

export type ListNamespacesParams = GitPageParams;

export interface ListRepositoriesParams extends GitPageParams {
  provider: string;
  namespace?: string;
  search?: string;
}

export interface ListBranchesParams extends GitPageParams {
  provider: string;
  repoName: string;
  namespace?: string;
  search?: string;
}

export class GitApi {
  constructor(private readonly client: RestApiClient) {}

  private request<T>(req: RestRequest): Promise<T> {
    return this.client.request<T>(req, GIT_ERROR_MESSAGES);
  }

  private async page<T>(req: RestRequest, key: string): Promise<T> {
    const response = await this.request<T>(req);

    assertArray(response, key, `a ${key} response`);

    return response;
  }

  namespaces(params: ListNamespacesParams): Promise<GitNamespacesPage> {
    return this.page<GitNamespacesPage>(
      {
        method: 'GET',
        path: '/git-namespaces',
        orgUid: params.org,
        query: { limit: params.limit, skip: params.skip },
      },
      'namespaces',
    );
  }

  repositories(params: ListRepositoriesParams): Promise<GitRepositoriesPage> {
    return this.page<GitRepositoriesPage>(
      {
        method: 'GET',
        path: '/git-repositories',
        orgUid: params.org,
        query: {
          provider: params.provider,
          namespace: params.namespace,
          search: params.search,
          limit: params.limit,
          skip: params.skip,
        },
      },
      'repositories',
    );
  }

  branches(params: ListBranchesParams): Promise<GitBranchesPage> {
    return this.page<GitBranchesPage>(
      {
        method: 'GET',
        path: '/git-branches',
        orgUid: params.org,
        query: {
          provider: params.provider,
          repoName: params.repoName,
          namespace: params.namespace,
          search: params.search,
          limit: params.limit,
          skip: params.skip,
        },
      },
      'branches',
    );
  }
}
