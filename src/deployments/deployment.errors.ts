import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import type { ErrorMessages } from '../transport/errors';

export const DEPLOYMENT_ERROR_MESSAGES: ErrorMessages = {
  'launch.DEPLOYMENT.NOT_FOUND': 'No deployment found with that UID.',
  'launch.DEPLOYMENT.CREATE_FAILED': 'The Launch API could not start a deployment.',
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that UID.',
};

export class DeploymentUnsuccessfulError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(message: string) {
    super(message);
    this.name = 'DeploymentUnsuccessfulError';
  }
}
