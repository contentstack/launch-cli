import type { ErrorMessages } from '../transport/errors';

export const GIT_ERROR_MESSAGES: ErrorMessages = {
  'launch.USERCONNECTION.NOT_FOUND':
    'No Git provider connection was found for this organization. Connect one in the Launch app and try again.',
  'launch.GIT_REPOSITORY.NOT_FOUND': 'No repository found with that name for this Git connection.',
  'launch.GIT_BRANCH.NOT_FOUND': 'No branch found with that name in that repository.',
  'launch.PROVIDER.REQUIRED': 'A Git provider is required to list namespaces, repositories or branches.',
};
