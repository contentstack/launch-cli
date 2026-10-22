import type { ErrorMessages } from '../transport/errors';

export const ENVIRONMENT_ERROR_MESSAGES: ErrorMessages = {
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that name or UID.',
  'launch.ENVIRONMENT.DUPLICATE_NAME': 'An environment with that name already exists in this project.',
  'launch.ENVIRONMENT.LIMIT_REACHED': 'This project has reached its environment limit.',
  'launch.ENVIRONMENT.CREATE_FAILED': 'The Launch API could not create that environment.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.BYTE_SIZE_LIMIT_REACHED':
    'The environment variables are larger than Launch allows. Remove some variables or shorten their values.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.MAX_COUNT_REACHED':
    'This environment has reached its limit on the number of variables.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.DUPLICATE_KEYS': 'The same variable key appears more than once.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_EMPTY': 'A variable key cannot be empty.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_STRING': 'A variable key must be text.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.TOO_LONG': 'A variable key is too long.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.NOT_EMPTY': 'A variable value cannot be empty.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.NOT_STRING': 'A variable value must be text.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.TOO_LONG': 'A variable value is too long.',
};

export const DUPLICATE_NAME_CODE = 'launch.ENVIRONMENT.DUPLICATE_NAME';
