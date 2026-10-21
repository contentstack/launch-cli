import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';

export const variableFlags = {
  var: Flags.string({
    multiple: true,
    description:
      'Environment variable as KEY=VALUE, repeatable. A KEY with no value is asked at a hidden prompt, ' +
      'or read from standard input when piped',
  }),
  dotenv: Flags.string({
    multiple: true,
    description: 'Path to a dotenv file, repeatable. Use - to read dotenv content from standard input',
  }),
  key: Flags.string({ multiple: true, description: 'Environment variable key, repeatable' }),
  'from-stack': Flags.boolean({
    description: 'Import the variables of a Contentstack stack. Asks for the stack and a delivery token on a terminal',
  }),
  alias: Flags.string({
    char: 'a',
    description: 'Alias of a delivery token saved with csdx auth:tokens:add, used with --from-stack without a prompt',
  }),
};

export const variableResolution = {
  var: {} satisfies ResolutionSpec<string[]>,
  dotenv: {} satisfies ResolutionSpec<string[]>,
  key: {} satisfies ResolutionSpec<string[]>,
  'from-stack': {} satisfies ResolutionSpec<boolean>,
  alias: {} satisfies ResolutionSpec<string>,
};
