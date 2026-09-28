import { PICKER_PAGE_SIZE } from '../core/constants';
import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/render';
import type { ApiSurface } from '../resources';
import { GitRepository } from '../git/types';

export interface CreatePromptDeps {
  api: ApiSurface;
  ux: UxLike;
}

export interface Choice {
  name: string;
  value: string;
}

function chosen(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    throw new CancelledError();
  }

  return String(value);
}

export async function askText(ux: UxLike, message: string, initial?: string): Promise<string> {
  return chosen(await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, default: initial }));
}

export async function askOptionalText(ux: UxLike, message: string, initial?: string): Promise<string | undefined> {
  const answer = await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, default: initial });
  const text = typeof answer === 'string' ? answer.trim() : '';

  return text === '' ? undefined : text;
}

export async function askChoice(ux: UxLike, message: string, choices: Choice[], initial?: string): Promise<string> {
  return chosen(
    await ux.inquire<string | undefined>({ type: 'search-list', name: 'value', message, choices, default: initial }),
  );
}

function noteTruncation(ux: UxLike, count: number | undefined, shown: number, noun: string, flag: string): void {
  if (typeof count === 'number' && count > shown) {
    ux.print(`Showing the first ${shown} of ${count} ${noun}. Use ${flag} to reach any of them.`);
  }
}

export function repositoryLabel(repository: GitRepository): string {
  return repository.fullName || repository.name || '';
}

export function repositorySearchTerm(wanted: string): string {
  return wanted.slice(wanted.lastIndexOf('/') + 1);
}

export function findRepository(repositories: GitRepository[], wanted: string): GitRepository | undefined {
  return repositories.find((repository) => repositoryLabel(repository) === wanted || repository.name === wanted);
}

export async function askBranch(
  deps: CreatePromptDeps,
  params: { org: string; provider: string; namespace: string; repoName: string },
  initial?: string,
): Promise<string> {
  const page = await deps.api.git.branches({ ...params, limit: PICKER_PAGE_SIZE, skip: 0 });
  const named = page.branches.filter((branch) => Boolean(branch.name));

  if (named.length === 0) {
    throw new UsageError(`No branches are available in "${params.repoName}".`);
  }

  noteTruncation(deps.ux, page.pagination.count, named.length, 'branches', '--branch');

  return askChoice(
    deps.ux,
    'Choose a branch',
    named.map((branch) => ({ name: branch.name as string, value: branch.name as string })),
    initial,
  );
}
