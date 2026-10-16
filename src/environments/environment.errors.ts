import type { ErrorMessages } from '../transport/errors';

export const ENVIRONMENT_ERROR_MESSAGES: ErrorMessages = {
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that name or UID.',
  'launch.ENVIRONMENT.DUPLICATE_NAME': 'An environment with that name already exists in this project.',
  'launch.ENVIRONMENT.LIMIT_REACHED': 'This project has reached its environment limit.',
  'launch.ENVIRONMENT.CREATE_FAILED': 'The Launch API could not create that environment.',
};

export const DUPLICATE_NAME_CODE = 'launch.ENVIRONMENT.DUPLICATE_NAME';
