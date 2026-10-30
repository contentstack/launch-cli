import { LaunchApiError } from '../transport/errors';
import type { ErrorMessages } from '../transport/errors';

const SECRETS_FORBIDDEN_CODE = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.FORBIDDEN';

export const SECRETS_FORBIDDEN_MESSAGE = 'You do not have permission to manage the secrets of this environment.';

export const SECRETS_ERROR_MESSAGES: ErrorMessages = {
  [SECRETS_FORBIDDEN_CODE]: SECRETS_FORBIDDEN_MESSAGE,
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that name or UID.',
};

export function asSecretsFailure(error: unknown): unknown {
  if (error instanceof LaunchApiError && error.status === 403) {
    return new LaunchApiError(403, [{ code: SECRETS_FORBIDDEN_CODE }], SECRETS_ERROR_MESSAGES);
  }

  return error;
}
