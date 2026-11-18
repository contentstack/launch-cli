import { cliux } from '@contentstack/cli-utilities';

import type { UxLike } from './prompt';
import { promptLibrary } from './search-list';

export interface Prompter {
  prompt(question: unknown): Promise<Record<string, unknown>>;
}

export function libraryUx(library: () => Prompter, print: (message: string) => void): UxLike {
  return {
    print,
    inquire: async <T>(payload: unknown): Promise<T> => {
      const { name } = payload as { name: string };
      const answers = await library().prompt(payload);

      return answers[name] as T;
    },
  };
}

// cli-utilities' own inquire calls process.exit(130) on Ctrl-C, so prompts go to the inquirer it wraps instead.
export const terminalUx: UxLike = libraryUx(promptLibrary, (message) => cliux.print(message));
