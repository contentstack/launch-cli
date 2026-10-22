import { UsageError } from '../core/errors';

export function notSetError(keys: string[]): UsageError {
  return new UsageError(`${keys.join(', ')} ${keys.length === 1 ? 'is' : 'are'} not set in this environment.`);
}

export function someNotSetError(keys: string[]): UsageError {
  return keys.length === 1
    ? notSetError(keys)
    : new UsageError(`At least one of ${keys.join(', ')} is not set in this environment.`);
}
