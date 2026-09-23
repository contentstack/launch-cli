import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';
import { oneOf, withinLength } from '../core/values';
import { ProjectRef } from './project-ref';
import type { ProjectType } from './types';
import { promptForProject } from './project.prompt';
import { ProjectResolver } from './project.resolver';

export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 255;

export const PROJECT_TYPE_CHOICES = ['GitHub', 'FileUpload'] as const;

export type ProjectTypeChoice = (typeof PROJECT_TYPE_CHOICES)[number];

export const PROJECT_TYPE_BY_CHOICE: Record<ProjectTypeChoice, ProjectType> = {
  GitHub: 'GITPROVIDER',
  FileUpload: 'FILEUPLOAD',
};

export function projectTypeChoiceOf(value: string): ProjectTypeChoice {
  return oneOf('type', value, PROJECT_TYPE_CHOICES);
}

export const projectFlags = {
  project: Flags.string({ description: 'Project name or UID' }),
  name: Flags.string({ description: `Project name (${PROJECT_NAME_MAX_LENGTH} characters or fewer)` }),
  description: Flags.string({
    description: `Project description (${PROJECT_DESCRIPTION_MAX_LENGTH} characters or fewer)`,
  }),
  type: Flags.string({ description: `Project type (${PROJECT_TYPE_CHOICES.join(' | ')})` }),
};

export const PROJECT_DEPENDENCIES = { project: ['org'] } as const;

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
  type: {
    normalize: async (value) => projectTypeChoiceOf(value) as string,
  } satisfies ResolutionSpec<string>,
};
