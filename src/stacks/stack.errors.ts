import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { asSentence } from '../core/values';

export class StackLookupError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(subject: string, reason: string) {
    super(`Could not list ${subject}: ${asSentence(reason)}`);
    this.name = 'StackLookupError';
  }
}
