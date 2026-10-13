import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { PromptDeps, UxLike } from '../core/prompt';
import { answered, checkLength } from '../core/prompt';
import { hasUid } from '../transport/envelope';
import type { Project, ProjectUpdate } from './types';
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_NAME_MAX_LENGTH } from './types';

export type UpdatableField = keyof ProjectUpdate;

interface FieldSpec {
  label: string;
  message: string;
  max: number;
}

export const UPDATABLE_FIELDS: Record<UpdatableField, FieldSpec> = {
  name: {
    label: 'Name',
    message: 'Update project name (optional)',
    max: PROJECT_NAME_MAX_LENGTH,
  },
  description: {
    label: 'Description',
    message: 'Update project description (optional)',
    max: PROJECT_DESCRIPTION_MAX_LENGTH,
  },
};

export const PROJECT_UPDATABLE_FIELDS = Object.keys(UPDATABLE_FIELDS) as UpdatableField[];

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

  return answered(
    await deps.ux.inquire<string | undefined>({
      type: 'search-list',
      name: 'project',
      message: 'Choose a project',
      choices: choosable.map((project) => ({ name: project.name ?? project.uid, value: project.uid })),
    }),
  );
}

export function checkFieldValue(field: UpdatableField, value: string): true | string {
  const spec = UPDATABLE_FIELDS[field];

  return checkLength(spec.label, value, spec.max);
}

export async function askFieldValue(ux: UxLike, field: UpdatableField): Promise<string> {
  const answer = await ux.inquire<string | undefined>({
    type: 'input',
    name: 'value',
    message: UPDATABLE_FIELDS[field].message,
    validate: (value: string) => checkFieldValue(field, value),
  });

  return typeof answer === 'string' ? answer.trim() : '';
}

export async function promptForProjectUpdate(
  ux: UxLike,
  current: Project,
  fields: readonly UpdatableField[] = PROJECT_UPDATABLE_FIELDS,
): Promise<ProjectUpdate> {
  const update: ProjectUpdate = {};

  for (const field of fields) {
    const value = await askFieldValue(ux, field);

    if (value !== '' && value !== current[field]) {
      update[field] = value;
    }
  }

  return update;
}
