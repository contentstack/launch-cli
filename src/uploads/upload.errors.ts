import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import type { ErrorMessages } from '../transport/errors';

export class UploadFailedError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(message: string) {
    super(message);
    this.name = 'UploadFailedError';
  }
}

export const UPLOAD_ERROR_MESSAGES: ErrorMessages = {
  'launch.PROJECT.FILE_UPLOAD_SIGNED_URL.GET_FAILED':
    'The Launch API could not prepare an upload for your project files.',
};
