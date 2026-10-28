import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';

export const deploymentFlags = {
  deployment: Flags.string({ description: 'Deployment UID' }),
};

export const deploymentResolution = {
  deployment: {
    normalize: async (value) => value.trim(),
  } satisfies ResolutionSpec<string>,
};
