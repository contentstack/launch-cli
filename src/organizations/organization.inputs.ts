import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import type { InputSource, ResolutionSpec } from '../core/resolution';
import { promptForOrganization } from './organization.prompt';

const ORGANIZATION_UID_PATTERN = /^blt[0-9a-f]{16}$/i;

export const organizationFlags = {
  org: Flags.string({ description: 'Organization UID' }),
};

async function organizationUidOf(value: string, { source }: { source: InputSource }): Promise<string> {
  if (source !== 'flag') {
    return value;
  }

  const uid = value.trim();

  if (!ORGANIZATION_UID_PATTERN.test(uid)) {
    throw new UsageError('--org accepts an organization UID, not a name.');
  }

  return uid;
}

export const organizationResolution = {
  org: {
    configPath: 'organizationUid',
    configLabel: 'organization',
    prompt: ({ services }) => promptForOrganization(services),
    normalize: organizationUidOf,
  } satisfies ResolutionSpec<string>,
};
