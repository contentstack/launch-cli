import type { ErrorMessages } from '../transport/errors';

export const PROJECT_ERROR_MESSAGES: ErrorMessages = {
  'launch.PROJECT.DUPLICATE_NAME': 'A project with that name already exists in this organization.',
  'launch.PROJECT.LIMIT_REACHED': 'This organization has reached its project limit.',
  'launch.PROJECT.NOT_FOUND': 'No project found with that name or UID.',
  'launch.PROJECT.DELETE_FAILED': 'The Launch API could not delete that project.',
  'launch.PROJECT.UPDATE_FAILED': 'The Launch API could not update that project.',
};
