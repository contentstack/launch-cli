import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { asSentence } from '../core/values';

export class OrganizationLookupError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(reason: string) {
    super(`Could not list your organizations: ${asSentence(reason)} Pass --org with an organization UID.`);
    this.name = 'OrganizationLookupError';
  }
}
