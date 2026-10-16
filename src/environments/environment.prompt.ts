import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { PromptDeps } from '../core/prompt';
import { askOption, noteTruncation } from '../core/prompt';
import { hasUid } from '../transport/envelope';

export async function promptForEnvironment(deps: PromptDeps, scope: { org: string; project: string }): Promise<string> {
  const page = await deps.api.environments.list({ ...scope, limit: PICKER_PAGE_SIZE, skip: 0 });
  const choosable = page.environments.filter(hasUid);

  if (choosable.length === 0) {
    throw new UsageError('No environments found in this project.');
  }

  noteTruncation(deps.ux, page.pagination.count, page.environments.length, 'environments', '--env');

  return askOption(
    deps.ux,
    'Choose an environment',
    choosable.map((environment) => ({
      name: environment.name?.trim() ? environment.name : environment.uid,
      value: environment.uid,
    })),
  );
}
