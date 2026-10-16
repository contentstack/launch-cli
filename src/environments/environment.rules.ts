import type { UxLike } from '../core/prompt';
import { styled } from '../core/style';
import { isAbsent } from '../core/values';
import { GIT_PROVIDER_GITHUB } from '../git/types';
import { malformed } from '../transport/envelope';
import type { ToggleValue } from './environment.inputs';

export const REPOSITORY_ONLY_FLAGS = ['branch', 'auto-deploy'] as const;

export type RepositoryOnlyFlag = (typeof REPOSITORY_ONLY_FLAGS)[number];

export function repositoryOnlyFlagLine(flag: RepositoryOnlyFlag, outputIsTTY: boolean): string {
  return styled(`warn: --${flag} is not supported for FileUpload projects.`, 'yellow', outputIsTTY);
}

interface RepositoryFlags {
  branch?: string;
  autoDeploy?: ToggleValue;
}

const FIELD_OF: Record<RepositoryOnlyFlag, keyof RepositoryFlags> = { branch: 'branch', 'auto-deploy': 'autoDeploy' };

export function withoutRepositoryFlags<T extends RepositoryFlags>(
  request: T,
  projectType: string | undefined,
  ux: UxLike,
  outputIsTTY: boolean,
): T {
  if (projectType !== 'FILEUPLOAD') {
    return request;
  }

  const kept = { ...request };

  for (const flag of REPOSITORY_ONLY_FLAGS) {
    if (kept[FIELD_OF[flag]] !== undefined) {
      ux.print(repositoryOnlyFlagLine(flag, outputIsTTY));
      delete kept[FIELD_OF[flag]];
    }
  }

  return kept;
}

export interface GitScope {
  org: string;
  provider: string;
  namespace: string;
  repoName: string;
}

export interface ProjectRepository {
  gitProvider?: string;
  repositoryName?: string;
  username?: string;
}

export function gitScopeOf(org: string, repository: ProjectRepository = {}): GitScope {
  const { repositoryName, username } = repository;

  if (repositoryName === undefined || username === undefined || isAbsent(repositoryName) || isAbsent(username)) {
    throw malformed('The Launch API returned a GitHub project without its repository name and owner.');
  }

  const provider = repository.gitProvider ?? GIT_PROVIDER_GITHUB;

  return { org, provider, namespace: username, repoName: repositoryName };
}
