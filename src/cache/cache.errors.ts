import { LaunchApiError } from '../transport/errors';
import type { ErrorMessages } from '../transport/errors';

export const PURGE_QUOTA_CODE = 'launch.ORGANIZATION.REVALIDATE_RATE_LIMIT_EXCEEDED';

const PURGE_FORBIDDEN_CODE = 'launch.CACHE.PURGE_FORBIDDEN';

const CLI_BUG_MESSAGE = 'The CLI sent a purge request the Launch API could not accept. This is a bug in the CLI.';

export const CACHE_ERROR_MESSAGES: ErrorMessages = {
  [PURGE_QUOTA_CODE]: 'This organization has reached its daily CDN cache purge limit. The limit resets at 00:00 UTC.',
  [PURGE_FORBIDDEN_CODE]: 'Purging the CDN cache needs permission to update the environment.',
  'launch.ENVIRONMENT.NOT_FOUND': 'No environment with that UID was found in this project.',
  'launch.ENVIRONMENT.REVALIDATE_CDN_CACHE.INVALID_INPUT.ONLY_ONE_OF_CACHEPATH_CACHETAGS_HOSTNAMES_ALLOWED':
    CLI_BUG_MESSAGE,
};

export function asPurgeFailure(error: unknown): unknown {
  if (!(error instanceof LaunchApiError) || error.status !== 403) {
    return error;
  }

  return new LaunchApiError(403, [{ code: PURGE_FORBIDDEN_CODE }], CACHE_ERROR_MESSAGES);
}
