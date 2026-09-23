import { PICKER_PAGE_SIZE } from '../core/constants';
import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/render';
import type { ApiSurface } from '../resources';

export interface PromptDeps {
  api: ApiSurface;
  ux: UxLike;
}

function nothingChosen(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export async function promptForProject(deps: PromptDeps, org: string): Promise<string> {
  const page = await deps.api.projects.list({ org, limit: PICKER_PAGE_SIZE, skip: 0 });

  if (page.projects.length === 0) {
    throw new UsageError('No projects found in this organization.');
  }

  if (page.pagination.count > page.projects.length) {
    deps.ux.print(
      `Showing the first ${page.projects.length} of ${page.pagination.count} projects; ` +
        'refine your search if the one you want is missing. ' +
        'Use --project <name> to reach any project in the organization.',
    );
  }

  const chosen = await deps.ux.inquire<string | undefined>({
    type: 'search-list',
    name: 'project',
    message: 'Choose a project',
    choices: page.projects.map((project) => ({ name: project.name, value: project.uid })),
  });

  if (nothingChosen(chosen)) {
    throw new CancelledError();
  }

  return chosen as string;
}
