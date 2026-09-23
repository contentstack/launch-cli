import { Flags } from '@contentstack/cli-utilities';

import { MAX_LIMIT, PROJECT_CONFIG_FILE } from './constants';

export const globalFlags = {
  org: Flags.string({ description: 'Organization UID' }),
  limit: Flags.integer({ min: 0, max: MAX_LIMIT, description: `Number of records to fetch (0-${MAX_LIMIT})` }),
  skip: Flags.integer({ min: 0, description: 'Number of records to skip' }),
  yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt' }),
  config: Flags.string({ char: 'c', description: `Path to the local '${PROJECT_CONFIG_FILE}' file` }),
  'data-dir': Flags.string({ char: 'd', description: 'Current working directory' }),
};
