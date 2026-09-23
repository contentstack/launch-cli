import { ApiSurface } from '../api';
import { MAX_LIMIT } from '../config/constants';
import { UsageError } from '../errors';
import { UxLike } from '../output/render';

export interface SelectDeps {
  api: ApiSurface;
  ux: UxLike;
}

const UID_PATTERN = /^[0-9a-f]{24}$/i;

export async function promptForProject(deps: SelectDeps, org: string): Promise<string> {
  const page = await deps.api.projects.list({ org, limit: MAX_LIMIT, skip: 0 });

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

  return deps.ux.inquire<string>({
    type: 'search-list',
    name: 'project',
    message: 'Choose a project',
    choices: page.projects.map((project) => ({ name: project.name, value: project.uid })),
  });
}

export async function resolveProjectUid(deps: SelectDeps, org: string, value: string): Promise<string> {
  if (UID_PATTERN.test(value)) {
    return value;
  }

  for await (const page of deps.api.projects.pages({ org })) {
    const match = page.projects.find((project) => project.name === value);

    if (match) {
      return match.uid;
    }
  }

  throw new UsageError(`No project named "${value}" found in this organization.`);
}
