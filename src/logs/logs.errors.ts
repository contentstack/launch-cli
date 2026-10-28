import type { ErrorMessages } from '../transport/errors';
import { DEPLOYMENT_ERROR_MESSAGES } from '../deployments/deployment.errors';

export const LOGS_ERROR_MESSAGES: ErrorMessages = {
  ...DEPLOYMENT_ERROR_MESSAGES,
  'launch.SERVERLOGS.NOT_INTEGER': 'The Launch API could not read the time window of the server logs.',
  'launch.LOGS.QUERY_TIMEOUT':
    'The server logs query took too long. Narrow the window with --since and --until and try again.',
  'launch.LOGS.REQUEST_TIMEOUT':
    'The Launch API took too long to answer. Try again, or narrow the window with --since and --until.',
  'launch.DEPLOYMENT.PROJECT_MISMATCH': 'That deployment does not belong to this project.',
  'launch.DEPLOYMENT.ENVIRONMENT_MISMATCH': 'That deployment does not belong to this environment.',
  'launch.PROJECT.NOT_FOUND': 'No project found with that UID.',
};
