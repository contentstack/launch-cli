import type { ErrorMessages } from '../transport/errors';

export const ENVIRONMENT_ERROR_MESSAGES: ErrorMessages = {
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that name or UID.',
  'launch.ENVIRONMENT.LIMIT_REACHED': 'This project has reached its environment limit.',
  'launch.ENVIRONMENT.CREATE_FAILED': 'The Launch API could not create that environment.',
};
