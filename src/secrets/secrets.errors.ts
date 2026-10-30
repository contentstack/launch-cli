import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { REDACTED } from '../core/redact';
import { LaunchApiError, LaunchNetworkError } from '../transport/errors';
import type { ApiErrorEntry, ErrorMessages } from '../transport/errors';

const ERROR_CODE_NAMESPACE = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS';

const SCOPE_NOT_FOUND_MESSAGE = 'The project or environment was not found.';

const READ_FORBIDDEN_CODE = `${ERROR_CODE_NAMESPACE}.READ_FORBIDDEN`;
const READ_REJECTED_CODE = `${ERROR_CODE_NAMESPACE}.READ_REJECTED`;
const SCOPE_NOT_FOUND_CODE = 'launch.ENVIRONMENT.NOT_FOUND';

export const SECRETS_ERROR_MESSAGES: ErrorMessages = {
  [`${ERROR_CODE_NAMESPACE}.KEY.CONFLICT`]: 'A secret or a variable with that key already exists in this environment.',
  [`${ERROR_CODE_NAMESPACE}.KEY.NOT_FOUND`]: 'No secret with that key exists in this environment.',
  [`${ERROR_CODE_NAMESPACE}.VALUE.MULTILINE`]: 'A secret value must be a single line.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE':
    "Another change to this environment's variables and secrets landed at the same moment, so nothing was changed. " +
    'Run the command again.',
  [SCOPE_NOT_FOUND_CODE]: SCOPE_NOT_FOUND_MESSAGE,
  'launch.PROJECT.NOT_FOUND': SCOPE_NOT_FOUND_MESSAGE,
  [READ_FORBIDDEN_CODE]: 'You do not have permission to view the secrets of this environment.',
  [READ_REJECTED_CODE]: 'The Launch API rejected the request to list the secrets of this environment.',
};

export function asReadFailure(error: unknown): unknown {
  if (!(error instanceof LaunchApiError)) {
    return error;
  }

  if (error.status === 403) {
    return new LaunchApiError(403, [{ code: READ_FORBIDDEN_CODE }], SECRETS_ERROR_MESSAGES);
  }

  if (error.status === 404) {
    return new LaunchApiError(404, [{ code: SCOPE_NOT_FOUND_CODE }], SECRETS_ERROR_MESSAGES);
  }

  if (error.status === 400) {
    return new LaunchApiError(400, [{ code: READ_REJECTED_CODE }], SECRETS_ERROR_MESSAGES);
  }

  return error;
}

const WRITE_FORBIDDEN_CODE = `${ERROR_CODE_NAMESPACE}.WRITE_FORBIDDEN`;
const WRITE_NOT_FOUND_CODE = `${ERROR_CODE_NAMESPACE}.WRITE_NOT_FOUND`;

const WRITE_MESSAGES: ErrorMessages = {
  ...SECRETS_ERROR_MESSAGES,
  [WRITE_FORBIDDEN_CODE]: 'You do not have permission to change the secrets of this environment.',
  [WRITE_NOT_FOUND_CODE]: 'The project, the environment or the secret was not found.',
};

export class SecretInputTimeoutError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(seconds: number) {
    super(
      `No value arrived on standard input within ${seconds} ${seconds === 1 ? 'second' : 'seconds'}, ` +
        'so nothing was changed. ' +
        'Pipe the value in, for example: printf \'%s\' "$TOKEN" | csdx launch:secrets:set --key <KEY> --yes',
    );
    this.name = 'SecretInputTimeoutError';
  }
}

export class SecretsNotRemovedError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(keys: string[], total: number) {
    super(`${keys.length} of ${total} ${total === 1 ? 'secret was' : 'secrets were'} not removed: ${keys.join(', ')}.`);
    this.name = 'SecretsNotRemovedError';
  }
}

export interface RemovalStop {
  removed: string[];
  failed: string[];
  notAttempted: string[];
  cause: unknown;
}

function named(keys: string[]): string {
  return keys.length === 0 ? 'none' : keys.join(', ');
}

export class SecretsRemovalStoppedError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;
  readonly cause: unknown;

  constructor({ removed, failed, notAttempted, cause }: RemovalStop) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    super(
      `Stopped at secret ${failed[failed.length - 1]}: ${reason}\n` +
        `Removed: ${named(removed)}.\nFailed: ${named(failed)}.\nNot attempted: ${named(notAttempted)}.`,
    );
    this.name = 'SecretsRemovalStoppedError';
    this.cause = cause;
  }
}

function withoutValue(text: string, value: string): string {
  return [value, value.trim()]
    .filter((form) => form !== '')
    .reduce((redacted, form) => redacted.split(form).join(REDACTED), text);
}

function redactedEntry(entry: ApiErrorEntry, value: string): ApiErrorEntry {
  return entry.message === undefined ? entry : { ...entry, message: withoutValue(entry.message, value) };
}

function reworded(error: LaunchApiError): LaunchApiError {
  if (error.status === 403) {
    return new LaunchApiError(403, [{ code: WRITE_FORBIDDEN_CODE }], WRITE_MESSAGES);
  }

  if (error.status === 404 && !(error.code in WRITE_MESSAGES)) {
    return new LaunchApiError(404, [{ code: WRITE_NOT_FOUND_CODE }], WRITE_MESSAGES);
  }

  return error;
}

export function asWriteFailure(error: unknown, value: string): unknown {
  if (error instanceof LaunchApiError) {
    const { status, errors } = reworded(error);

    return new LaunchApiError(
      status,
      errors.map((entry) => redactedEntry(entry, value)),
      WRITE_MESSAGES,
    );
  }

  if (error instanceof LaunchNetworkError) {
    return new LaunchNetworkError(withoutValue(error.message, value), undefined, error.retryable);
  }

  if (error instanceof LaunchError) {
    return error;
  }

  return error instanceof Error ? new Error(withoutValue(error.message, value)) : error;
}
