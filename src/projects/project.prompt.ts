import { PICKER_PAGE_SIZE } from '../core/constants';
import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/render';
import type { ApiSurface } from '../resources';
import { hasUid } from '../transport/envelope';

export interface PromptDeps {
  api: ApiSurface;
  ux: UxLike;
}

function nothingChosen(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export async function promptForProject(deps: PromptDeps, org: string): Promise<string> {
  const page = await deps.api.projects.list({ org, limit: PICKER_PAGE_SIZE, skip: 0 });
  const choosable = page.projects.filter(hasUid);

  if (choosable.length === 0) {
    throw new UsageError('No projects found in this organization.');
  }

  const total = page.pagination.count;

  if (typeof total === 'number' && total > page.projects.length) {
    deps.ux.print(
      `Showing the first ${page.projects.length} of ${total} projects; ` +
        'refine your search if the one you want is missing. ' +
        'Use --project <name> to reach any project in the organization.',
    );
  }

  const chosen = await deps.ux.inquire<string | undefined>({
    type: 'search-list',
    name: 'project',
    message: 'Choose a project',
    choices: choosable.map((project) => ({ name: project.name ?? project.uid, value: project.uid })),
  });

  if (nothingChosen(chosen)) {
    throw new CancelledError();
  }

  return chosen as string;
}
