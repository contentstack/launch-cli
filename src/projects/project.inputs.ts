import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';
import { ProjectRef } from './project-ref';
import { promptForProject } from './project.prompt';
import { ProjectResolver } from './project.resolver';

export const projectFlags = {
  project: Flags.string({ description: 'Project name or UID' }),
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
};
