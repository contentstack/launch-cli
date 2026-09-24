import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';
import { promptForOrganization } from './organization.prompt';

export const organizationFlags = {
  org: Flags.string({ description: 'Organization UID' }),
};

export const organizationResolution = {
  org: {
    configPath: 'organizationUid',
    prompt: ({ services }) => promptForOrganization(services),
  } satisfies ResolutionSpec<string>,
};
