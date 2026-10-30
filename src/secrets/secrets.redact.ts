export const GENERIC_ARGUMENTS_MESSAGE =
  'Invalid arguments. A secret value is never taken from the command line: ' +
  'type it at the prompt, or pipe it in on stdin.';

const FLAG_ASSIGNMENT = /(?<![\w-])(-{1,2}[\w-]+)=.*/g;
const UNEXPECTED_ARGUMENTS = /Unexpected arguments?:.*$/gm;

function scrubbed(text: string): string {
  return text.replace(FLAG_ASSIGNMENT, '$1').replace(UNEXPECTED_ARGUMENTS, GENERIC_ARGUMENTS_MESSAGE);
}

export function withoutArgumentValues<E extends Error>(error: E): E {
  error.message = scrubbed(error.message);

  if (error.stack !== undefined) {
    error.stack = scrubbed(error.stack);
  }

  return error;
}
