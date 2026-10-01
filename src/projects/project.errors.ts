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

/**
 * A taken name, reported the way V1 did: its lines are already printed when this is thrown, so the
 * command exits 1 without printing the message a second time.
 */
export class DuplicateProjectNameError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  readonly reported = true;

  constructor() {
    super('Duplicate project name identified');
    this.name = 'DuplicateProjectNameError';
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
