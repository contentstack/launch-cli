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

export function checkLength(label: string, value: string, max: number): true | string {
  const length = value.trim().length;

  return length > max ? `${label} must be ${max} characters or fewer; that value is ${length} characters.` : true;
}

/**
 * A `max` is checked inside the prompt, the way projects:update checks its fields, so a value that is
 * too long is answered again on the spot rather than failing the command after the upload.
 */
export async function askText(ux: UxLike, message: string, initial?: string, max?: number): Promise<string> {
  const validate = max === undefined ? undefined : (value: string) => checkLength(message, value, max);

  return chosen(
    await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, default: initial, validate }),
  );
}

export async function askOptionalText(ux: UxLike, message: string, initial?: string): Promise<string | undefined> {
  const answer = await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, default: initial });
  const text = typeof answer === 'string' ? answer.trim() : '';

  return text === '' ? undefined : text;
}

export async function askOption(ux: UxLike, message: string, choices: Choice[], initial?: string): Promise<string> {
  return chosen(
    await ux.inquire<string | undefined>({ type: 'list', name: 'value', message, choices, default: initial }),
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

  return askOption(
    deps.ux,
    'Choose a branch',
    named.map((branch) => ({ name: branch.name as string, value: branch.name as string })),
    initial,
  );
}
