import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import type { ResolutionSpec } from '../core/resolution';
import { ProjectRef } from './project-ref';
import { promptForProject } from './project.prompt';
import { ProjectResolver } from './project.resolver';

export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 255;

export const projectFlags = {
  project: Flags.string({ description: 'Project name or UID' }),
  name: Flags.string({ description: `Project name (${PROJECT_NAME_MAX_LENGTH} characters or fewer)` }),
  description: Flags.string({
    description: `Project description (${PROJECT_DESCRIPTION_MAX_LENGTH} characters or fewer)`,
  }),
};

export const PROJECT_DEPENDENCIES = { project: ['org'] } as const;

async function withinLength(flag: string, value: string, max: number): Promise<string> {
  if (value.length > max) {
    throw new UsageError(`--${flag} must be ${max} characters or fewer; that value is ${value.length} characters.`);
  }

  return value;
}

export const projectResolution = {
  project: {
    configPath: 'uid',
    dependsOn: PROJECT_DEPENDENCIES.project,
    prompt: ({ services, resolved }) => promptForProject(services, resolved.org),
    normalize: (value, { services, resolved, source }) =>
      new ProjectResolver(services.api.projects).toUid(
        resolved.org,
        source === 'flag' ? ProjectRef.parse(value) : ProjectRef.uid(value),
      ),
  } satisfies ResolutionSpec<string, 'org'>,
  name: {
    normalize: (value) => withinLength('name', value, PROJECT_NAME_MAX_LENGTH),
  } satisfies ResolutionSpec<string>,
  description: {
    normalize: (value) => withinLength('description', value, PROJECT_DESCRIPTION_MAX_LENGTH),
  } satisfies ResolutionSpec<string>,
};
