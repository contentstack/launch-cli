import { Flags } from '@contentstack/cli-utilities';

import { CLIENT_MAX_LIMIT, PROJECT_CONFIG_FILE } from './constants';
import { FlagValueError } from './errors';

const WHOLE_NUMBER = /^-?\d+$/;

function rangeOf(min: number, max: number | undefined): string {
  return max === undefined ? `of ${min} or more` : `from ${min} to ${max}`;
}

export function wholeNumberFlag(name: string, min: number, max: number | undefined, description: string) {
  return Flags.custom<number>({
    description,
    parse: async (input: string) => {
      const value = input.trim();
      const parsed = Number(value);

      const exact = WHOLE_NUMBER.test(value) && Number.isSafeInteger(parsed);

      if (!exact || parsed < min || (max !== undefined && parsed > max)) {
        throw new FlagValueError(`Invalid --${name} value "${input}". Provide a whole number ${rangeOf(min, max)}.`);
      }

      return parsed;
    },
  })();
}

export const coreFlags = {
  limit: wholeNumberFlag('limit', 1, CLIENT_MAX_LIMIT, `Number of records to fetch (1-${CLIENT_MAX_LIMIT})`),
  skip: wholeNumberFlag('skip', 0, undefined, 'Number of records to skip'),
  yes: Flags.boolean({ description: 'Skip the confirmation prompt' }),
  config: Flags.string({ description: `Path to the local '${PROJECT_CONFIG_FILE}' file` }),
  'data-dir': Flags.string({ char: 'd', description: 'Current working directory' }),
};
