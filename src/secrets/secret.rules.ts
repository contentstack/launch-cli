import { Errors } from '@oclif/core';

import { UsageError } from '../core/errors';

export const CLIENT_EXPOSED_PREFIXES = ['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_'] as const;

export const INVALID_ARGUMENTS_MESSAGE =
  'Invalid arguments. Run csdx launch:secrets:set --help to see the accepted flags. ' +
  'The value is never a flag or an argument: pipe it in or type it at the prompt.';

export const UNSET_INVALID_ARGUMENTS_MESSAGE =
  'Invalid arguments. Run csdx launch:secrets:unset --help to see the accepted flags. ' +
  'Pass each secret as --key <KEY>, not as a bare argument.';

export function clientExposedPrefix(key: string): string | undefined {
  return CLIENT_EXPOSED_PREFIXES.find((prefix) => key.startsWith(prefix));
}

export function clientExposedWarning(key: string): string | undefined {
  const prefix = clientExposedPrefix(key);

  return prefix === undefined
    ? undefined
    : `Warning: ${key} starts with ${prefix}, so its value is inlined into client JavaScript at build time ` +
        'and is readable by anyone who loads the site. Do not keep a credential under this name.';
}

export function emptyValueError(key: string): UsageError {
  return new UsageError(`The value for ${key} is empty. A secret needs a non-empty value; nothing was changed.`);
}

export function singleKeyError(count: number): UsageError {
  return new UsageError(
    count === 0
      ? 'Missing required value for --key. Pass --key.'
      : 'launch:secrets:set sets one secret at a time. Pass --key once.',
  );
}

export function asSafeArgvFailure(error: unknown, message: string = INVALID_ARGUMENTS_MESSAGE): unknown {
  const isParseFailure = error instanceof Errors.CLIError && Object.prototype.hasOwnProperty.call(error, 'parse');

  return isParseFailure ? new UsageError(message) : error;
}
