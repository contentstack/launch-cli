import { EXIT_RUNTIME } from '../core/constants';
import type { ExitCode } from '../core/errors';
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

/**
 * Any other create failure, reported under V1's "New project creation failed!" header with its cause on
 * the line below. Both lines are printed when this is thrown, so the command exits on the cause's own
 * code without printing the message again.
 */
export class ProjectCreateFailedError extends LaunchError {
  readonly exitCode: ExitCode;

  readonly reported = true;

  constructor(readonly failure: LaunchError) {
    super(failure.message);
    this.name = 'ProjectCreateFailedError';
    this.exitCode = failure.exitCode;
  }
}

export const PROJECT_ERROR_MESSAGES: ErrorMessages = {
  ...GIT_PROVIDER_ERROR_MESSAGES,
  'launch.PROJECT.DUPLICATE_NAME': 'A project with that name already exists in this organization.',
  'launch.PROJECT.LIMIT_REACHED': 'This organization has reached its project limit.',
  'launch.PROJECT.NOT_FOUND': 'No project found with that name or UID.',
  'launch.PROJECT.DELETE_FAILED': 'The Launch API could not delete that project.',
  'launch.PROJECT.UPDATE_FAILED': 'The Launch API could not update that project.',
  'launch.PROJECT.CREATE_FAILED': 'The Launch API could not create that project.',
  'launch.PROJECT.NAME.TOO_LONG': 'Project name must be 200 characters or fewer.',
  'launch.PROJECT.UPLOADED_FILE_NOT_FOUND_ERROR':
    'Your uploaded project files could not be found; the upload may have expired. Run the command again.',
  'launch.PROJECT.FILE_UPLOAD_SIGNED_URL.GET_FAILED':
    'The Launch API could not prepare an upload for your project files.',
};
