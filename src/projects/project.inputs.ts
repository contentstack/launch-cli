import { Flags } from '@contentstack/cli-utilities';

import { MissingInputError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ResolutionSpec } from '../core/resolution';
import type { ServiceContext } from '../core/service-context';
import { oneOf, withinLength } from '../core/values';
import { ProjectRef } from './project-ref';
import type { ProjectType } from './types';
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_NAME_MAX_LENGTH } from './types';
import { askOption } from '../core/prompt';
import { promptForProject } from './project.prompt';
import { ProjectResolver } from './project.resolver';

export const PROJECT_TYPE_CHOICES = ['GitHub', 'FileUpload'] as const;

export type ProjectTypeChoice = (typeof PROJECT_TYPE_CHOICES)[number];

export const PROJECT_TYPE_BY_CHOICE: Record<ProjectTypeChoice, ProjectType> = {
  GitHub: 'GITPROVIDER',
  FileUpload: 'FILEUPLOAD',
};

export function projectTypeChoiceOf(value: string): ProjectTypeChoice {
  return oneOf('type', value, PROJECT_TYPE_CHOICES);
}

export const PROJECT_TYPE_QUESTION = 'Choose a project type to proceed';

export function askProjectType(ux: UxLike): Promise<string> {
  return askOption(
    ux,
    PROJECT_TYPE_QUESTION,
    PROJECT_TYPE_CHOICES.map((value) => ({ name: `Continue with ${value}`, value })),
  );
}

export const CREATE_PROMPT_REMEDIES = { config: false, prompt: true };

export async function needInput<T extends string | undefined>(
  services: ServiceContext,
  flag: string,
  supplied: string | undefined,
  ask: () => Promise<T>,
): Promise<string | T> {
  if (supplied !== undefined) {
    return supplied;
  }

  if (!services.isTTY) {
    throw new MissingInputError(flag, CREATE_PROMPT_REMEDIES);
  }

  return ask();
}

export const GIT_ONLY_FLAGS = ['branch', 'auto-deploy'] as const;

export type GitOnlyFlag = (typeof GIT_ONLY_FLAGS)[number];

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
    configLabel: 'project',
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
    prompt: ({ services }) => askProjectType(services.ux),
    normalize: async (value) => projectTypeChoiceOf(value),
  } satisfies ResolutionSpec<string, never, ProjectTypeChoice>,
};
