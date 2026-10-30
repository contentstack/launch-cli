import { EXIT_CANCELLED, EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import type { ErrorMessages } from '../transport/errors';

export const DEPLOYMENT_NOT_FOUND_CODE = 'launch.DEPLOYMENT.NOT_FOUND';

export const INVALID_DEPLOYMENT_UID_CODE = 'launch.DEPLOYMENT.INVALID_DEPLOYMENT_UID';

export const INVALID_DEPLOYMENT_UID_RAW_MESSAGE =
  'Invalid deployment_uid. Argument passed in must be a string of 12 bytes or a string of 24 hex characters.';

const INVALID_DEPLOYMENT_UID_MESSAGE =
  'The deployment UID is invalid. Provide a 24-character hexadecimal deployment UID.';

export const CANCEL_NOT_ALLOWED_CODE = 'launch.DEPLOYMENT.CANCEL_NOT_ALLOWED';

export const CANCEL_NOT_ALLOWED_RAW_MESSAGE =
  'This deployment has progressed beyond the point where it can be cancelled.';

export function cancelNotAllowedMessage(deployment: string): string {
  return `Deployment "${deployment}" cannot be cancelled because it is no longer in progress.`;
}

export function cancelNotAllowedError(deployment: string, status = 400): LaunchApiError {
  return new LaunchApiError(status, [{ code: CANCEL_NOT_ALLOWED_CODE, message: cancelNotAllowedMessage(deployment) }]);
}

export const DEPLOYMENT_ERROR_MESSAGES: ErrorMessages = {
  [DEPLOYMENT_NOT_FOUND_CODE]: 'No deployment found with that UID.',
  [INVALID_DEPLOYMENT_UID_CODE]: INVALID_DEPLOYMENT_UID_MESSAGE,
  [INVALID_DEPLOYMENT_UID_RAW_MESSAGE]: INVALID_DEPLOYMENT_UID_MESSAGE,
  'launch.DEPLOYMENT.CREATE_FAILED': 'The deployment could not be started. Please try again or contact support.',
  'launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE':
    'This deployment is not eligible for rollback. Choose a deployment that was live earlier.',
  'launch.DEPLOYMENT.NO_LIVE_DEPLOYMENT_FOUND':
    'This environment has no live deployment, so a rollback is not possible.',
  'launch.DEPLOYMENT.ROLLBACK_INVALID_STATUS':
    'The status of this deployment does not allow a rollback. Choose a deployment that was live earlier.',
  'launch.DEPLOYMENT.ROLLBACK_TO_CURRENT_DEPLOYMENT':
    'This deployment is already live in this environment. Choose a different deployment for rollback.',
  'launch.DEPLOYMENT.ROLLBACK_FAILED': 'The rollback could not be completed. Please try again or contact support.',
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment found with that UID.',
};

export class DeploymentUnsuccessfulError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(message: string) {
    super(message);
    this.name = 'DeploymentUnsuccessfulError';
  }
}

export class DeploymentWaitInterruptedError extends LaunchError {
  readonly exitCode = EXIT_CANCELLED;

  constructor(message: string) {
    super(message);
    this.name = 'DeploymentWaitInterruptedError';
  }
}
