import type { UxLike } from '../core/render';
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_NAME_MAX_LENGTH } from './project.inputs';
import { PROJECT_UPDATABLE_FIELDS } from './project.presenter';
import type { Project, ProjectUpdate } from './types';

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

export function checkFieldValue(field: UpdatableField, value: string): true | string {
  const spec = UPDATABLE_FIELDS[field];
  const length = value.trim().length;

  if (length > spec.max) {
    return `${spec.label} must be ${spec.max} characters or fewer; that value is ${length} characters.`;
  }

  return true;
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
