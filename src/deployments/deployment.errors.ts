import { EXIT_CANCELLED, EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import type { ErrorMessages } from '../transport/errors';

export const CANCEL_NOT_ALLOWED_CODE = 'launch.DEPLOYMENT.CANCEL_NOT_ALLOWED';

export const CANCEL_NOT_ALLOWED_RAW_MESSAGE =
  'This deployment has progressed beyond the point where it can be cancelled.';

export const DEPLOYMENT_ERROR_MESSAGES: ErrorMessages = {
  'launch.DEPLOYMENT.NOT_FOUND': 'No deployment found with that UID.',
  'launch.DEPLOYMENT.CREATE_FAILED': 'The Launch API could not start a deployment.',
  [CANCEL_NOT_ALLOWED_CODE]:
    'This deployment can no longer be cancelled because it is already past the point where cancelling is possible.',
  [CANCEL_NOT_ALLOWED_RAW_MESSAGE]:
    'This deployment can no longer be cancelled because it is already past the point where cancelling is possible.',
  'launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE':
    'That deployment cannot be rolled back to. Only a deployment that went live earlier is eligible.',
  'launch.DEPLOYMENT.NO_LIVE_DEPLOYMENT_FOUND':
    'This environment has no live deployment to roll back from.',
  'launch.DEPLOYMENT.ROLLBACK_INVALID_STATUS':
    'That deployment is not in a status that can be rolled back to.',
  'launch.DEPLOYMENT.ROLLBACK_TO_CURRENT_DEPLOYMENT':
    'That deployment is already the live deployment of this environment.',
  'launch.DEPLOYMENT.ROLLBACK_FAILED': 'The Launch API could not roll back the deployment.',
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
