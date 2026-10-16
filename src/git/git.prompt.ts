import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { PromptDeps } from '../core/prompt';
import { askOption, noteTruncation } from '../core/prompt';
import { isAbsent } from '../core/values';
import { repositoryLabel } from './git.presenter';
import type { GitRepository } from './types';

export function repositorySearchTerm(wanted: string): string {
  return wanted.slice(wanted.lastIndexOf('/') + 1);
}

export function findRepository(repositories: GitRepository[], wanted: string): GitRepository | undefined {
  const name = wanted.toLowerCase();

  return repositories.find(
    (repository) =>
      repositoryLabel(repository).toLowerCase() === name || (repository.name ?? '').toLowerCase() === name,
  );
}

export async function askBranch(
  deps: PromptDeps,
  params: { org: string; provider: string; namespace: string; repoName: string },
  initial?: string,
): Promise<string> {
  const page = await deps.api.git.branches({ ...params, limit: PICKER_PAGE_SIZE, skip: 0 });
  const named = page.branches.filter((branch) => Boolean(branch.name));

  if (named.length === 0) {
    throw new UsageError(`No branches are available in "${params.repoName}".`);
  }

  noteTruncation(deps.ux, page.pagination.count, named.length, 'branches', '--branch');

  const names = named.map((branch) => branch.name as string);
  const listed = initial === undefined || isAbsent(initial) || names.includes(initial) ? names : [initial, ...names];

  return askOption(
    deps.ux,
    'Choose a branch',
    listed.map((name) => ({ name, value: name })),
    initial,
  );
}
