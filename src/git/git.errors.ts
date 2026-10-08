import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { LaunchApiError, type ErrorMessages } from '../transport/errors';

export const GIT_PROVIDER_ERROR_MESSAGES: ErrorMessages = {
  'launch.GIT_PROVIDER.UNAUTHORIZED_ACCESS':
    'Launch could not access your GitHub account. Reconnect GitHub in the Launch app, then try again.',
};

/**
 * Every code here is one management-service really sends: the git ones are the `CommonErrorCodes`
 * of `src/provider/errors/common-error-codes.ts`. A code that matches nothing simply never fires,
 * leaving the API's own terser English on screen, so `git.api.test.ts` drives each one through the
 * error envelope instead of listing this map back at itself - that way a code which has drifted
 * from the service is caught rather than asserted to be correct.
 */
export const GIT_ERROR_MESSAGES: ErrorMessages = {
  ...GIT_PROVIDER_ERROR_MESSAGES,
  'launch.REPOSITORY.NOT_FOUND': 'No repository found with that name for this Git connection.',
  'launch.BRANCH.NOT_FOUND': 'No branch found with that name in that repository.',
  'launch.PROVIDER.REQUIRED': 'A Git provider is required to list namespaces, repositories or branches.',
};

/**
 * There is no code for this one: management-service raises a bare `NotFoundException` whose message
 * is all that reaches the wire, so the message is what has to be recognised. The code is kept as a
 * second route in case the service ever names it.
 */
export const GIT_CONNECTION_NOT_FOUND_CODE = 'launch.USERCONNECTION.NOT_FOUND';

const GIT_CONNECTION_NOT_FOUND_TEXT = 'no user connection found';

export function isMissingGitConnection(error: unknown): boolean {
  if (!(error instanceof LaunchApiError)) {
    return false;
  }

  return (
    error.code === GIT_CONNECTION_NOT_FOUND_CODE ||
    error.errors.some((entry) => (entry.message ?? '').toLowerCase().includes(GIT_CONNECTION_NOT_FOUND_TEXT))
  );
}

export class GitNamespaceNotConnectedError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  readonly reported = true;

  readonly namespace: string;

  readonly connected: readonly string[];

  constructor(namespace: string, connected: readonly string[]) {
    super(`No GitHub connection for "${namespace}".`);
    this.name = 'GitNamespaceNotConnectedError';
    this.namespace = namespace;
    this.connected = connected;
  }
}

export class GitConnectionMissingError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  readonly reported = true;

  readonly connectUrl?: string;

  constructor(provider: string, connectUrl?: string) {
    super(`${provider} connection not found!`);
    this.name = 'GitConnectionMissingError';
    this.connectUrl = connectUrl;
  }
}
