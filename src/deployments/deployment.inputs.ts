import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import { UID_PATTERN } from '../core/resource-ref';
import type { ResolutionSpec } from '../core/resolution';

export const DEPLOYMENT_DEPENDENCIES = { deployment: ['org', 'project', 'env'] } as const;

function deploymentUidOf(value: string): string {
  if (!UID_PATTERN.test(value)) {
    throw new UsageError(`--deployment must be a 24-character deployment UID; "${value}" is not one.`);
  }

  return value;
}

export const deploymentFlags = {
  deployment: Flags.string({
    description: 'Deployment UID',
    parse: async (input) => deploymentUidOf(input),
  }),
};

export const deploymentResolution = {
  deployment: {
    dependsOn: DEPLOYMENT_DEPENDENCIES.deployment,
    normalize: async (value) => deploymentUidOf(value),
  } satisfies ResolutionSpec<string, 'org' | 'project' | 'env'>,
};
