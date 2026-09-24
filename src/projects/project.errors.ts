import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import type { ErrorMessages } from '../transport/errors';
import { GIT_PROVIDER_ERROR_MESSAGES } from '../git/git.errors';

export class UploadFailedError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(message: string) {
    super(message);
    this.name = 'UploadFailedError';
  }
}

export const PROJECT_ERROR_MESSAGES: ErrorMessages = {
  ...GIT_PROVIDER_ERROR_MESSAGES,
  'launch.PROJECT.DUPLICATE_NAME': 'A project with that name already exists in this organization.',
  'launch.PROJECT.LIMIT_REACHED': 'This organization has reached its project limit.',
  'launch.PROJECT.NOT_FOUND': 'No project found with that name or UID.',
  'launch.PROJECT.DELETE_FAILED': 'The Launch API could not delete that project.',
  'launch.PROJECT.UPDATE_FAILED': 'The Launch API could not update that project.',
};
