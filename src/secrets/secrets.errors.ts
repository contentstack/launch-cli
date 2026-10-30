import { LaunchApiError } from '../transport/errors';
import type { ErrorMessages } from '../transport/errors';

const SECRETS_FORBIDDEN_CODE = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.FORBIDDEN';

export const SECRETS_FORBIDDEN_MESSAGE = 'You do not have permission to manage the secrets of this environment.';

export const SECRETS_ERROR_MESSAGES: ErrorMessages = {
  [SECRETS_FORBIDDEN_CODE]: SECRETS_FORBIDDEN_MESSAGE,
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that name or UID.',
};

const CODE = 'launch.ENVIRONMENT.';

export function secretKeyMessages(key: string): ErrorMessages {
  const taken = `The key ${key} is already used by a variable or a secret in this environment.`;

  return {
    ...SECRETS_ERROR_MESSAGES,
    [`${CODE}ENVIRONMENT_SECRETS.KEY.CONFLICT`]: taken,
    [`${CODE}ENVIRONMENT_SECRETS.KEY.NOT_FOUND`]: `The secret ${key} was not found in this environment.`,
    [`${CODE}ENVIRONMENT_SECRETS.VALUE.MULTILINE`]: 'Invalid value: a secret value cannot contain line breaks.',
    [`${CODE}ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE`]:
      'The environment was changed by another request at the same moment. Run the command again.',
    [`${CODE}ENVIRONMENT_VARIABLES.KEY.NOT_EMPTY`]: 'Invalid key: the key cannot be empty.',
    [`${CODE}ENVIRONMENT_VARIABLES.KEY.NOT_STRING`]: 'Invalid key: the key must be text.',
    [`${CODE}ENVIRONMENT_VARIABLES.KEY.TOO_LONG`]: 'Invalid key: the key is too long.',
    [`${CODE}ENVIRONMENT_VARIABLES.VALUE.NOT_EMPTY`]: 'Invalid value: the value cannot be empty.',
    [`${CODE}ENVIRONMENT_VARIABLES.VALUE.NOT_STRING`]: 'Invalid value: the value must be text.',
    [`${CODE}ENVIRONMENT_VARIABLES.VALUE.TOO_LONG`]: 'Invalid value: the value is too long.',
  };
}

export function asSecretsFailure(error: unknown): unknown {
  if (error instanceof LaunchApiError && error.status === 403) {
    return new LaunchApiError(403, [{ code: SECRETS_FORBIDDEN_CODE }], SECRETS_ERROR_MESSAGES);
  }

  return error;
}
