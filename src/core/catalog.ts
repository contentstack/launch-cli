import { Flags } from '@contentstack/cli-utilities';

import { MAX_LIMIT, PROJECT_CONFIG_FILE } from './constants';

export const catalog = {
  org: Flags.string({ description: 'Organization UID' }),
  project: Flags.string({ description: 'Project name or UID' }),
  limit: Flags.integer({ description: `Number of records to fetch (0-${MAX_LIMIT})` }),
  skip: Flags.integer({ description: 'Number of records to skip' }),
  yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt' }),
  config: Flags.string({ char: 'c', description: `Path to the local '${PROJECT_CONFIG_FILE}' file` }),
  'data-dir': Flags.string({ char: 'd', description: 'Current working directory' }),
};

export type Catalog = typeof catalog;
export type FlagKey = keyof Catalog;
