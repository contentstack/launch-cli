import { LaunchApiError } from '../transport/errors';
import type { ErrorMessages } from '../transport/errors';

const SECRETS = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS';

const SCOPE_NOT_FOUND_MESSAGE = 'The project or environment was not found.';

const READ_FORBIDDEN_CODE = `${SECRETS}.READ_FORBIDDEN`;
const READ_REJECTED_CODE = `${SECRETS}.READ_REJECTED`;
const SCOPE_NOT_FOUND_CODE = 'launch.ENVIRONMENT.NOT_FOUND';

export const SECRETS_ERROR_MESSAGES: ErrorMessages = {
  [`${SECRETS}.KEY.CONFLICT`]: 'A secret or a variable with that key already exists in this environment.',
  [`${SECRETS}.KEY.NOT_FOUND`]: 'No secret with that key exists in this environment.',
  [`${SECRETS}.VALUE.MULTILINE`]: 'A secret value must be a single line.',
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
