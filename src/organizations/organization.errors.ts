import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';

function sentence(reason: string): string {
  const text = reason.trim();

  return text.endsWith('.') ? text : `${text}.`;
}

export class OrganizationLookupError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(reason: string) {
    super(`Could not list your organizations: ${sentence(reason)} Pass --org with an organization UID.`);
    this.name = 'OrganizationLookupError';
  }
}
