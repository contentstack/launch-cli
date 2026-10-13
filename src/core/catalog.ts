import { Flags } from '@contentstack/cli-utilities';

import { CLIENT_MAX_LIMIT, PROJECT_CONFIG_FILE } from './constants';

export const coreFlags = {
  limit: Flags.integer({
    min: 1,
    max: CLIENT_MAX_LIMIT,
    description: `Number of records to fetch (1-${CLIENT_MAX_LIMIT})`,
  }),
  skip: Flags.integer({ min: 0, description: 'Number of records to skip' }),
  yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt' }),
  config: Flags.string({ char: 'c', description: `Path to the local '${PROJECT_CONFIG_FILE}' file` }),
  'data-dir': Flags.string({ char: 'd', description: 'Current working directory' }),
};
