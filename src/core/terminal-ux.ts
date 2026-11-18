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

// cliux.inquire calls process.exit(130) on Ctrl-C itself, so prompts skip it and reach the inquirer it wraps.
export const terminalUx: UxLike = libraryUx(promptLibrary, (message) => cliux.print(message));
