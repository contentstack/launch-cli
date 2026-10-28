import { EXIT_RUNTIME } from '../core/constants';
import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import { CACHE_ERROR_MESSAGES, asPurgeFailure } from './cache.errors';

const QUOTA_CODE = 'launch.ORGANIZATION.REVALIDATE_RATE_LIMIT_EXCEEDED';
const CLI_BUG_MESSAGE = 'The CLI sent a purge request the Launch API could not accept. This is a bug in the CLI.';
const BUG_CODE = 'launch.ENVIRONMENT.REVALIDATE_CDN_CACHE.INVALID_INPUT.ONLY_ONE_OF_CACHEPATH_CACHETAGS_HOSTNAMES_ALLOWED';

describe('CACHE_ERROR_MESSAGES', () => {
  it('words the daily purge quota 429 as the limit and when it resets, exiting 1', () => {
    const error = parseErrorEnvelope(429, { errors: [{ code: QUOTA_CODE, message: 'Rate limit exceeded' }] }, CACHE_ERROR_MESSAGES);

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.message).toBe(
      'This organization has reached its daily CDN cache purge limit. The limit resets at 00:00 UTC.',
    );
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });

  it('keeps the API wording for a 429 with another code', () => {
    const error = parseErrorEnvelope(429, { errors: [{ code: 'launch.RATE_LIMITED', message: 'Too many requests.' }] }, CACHE_ERROR_MESSAGES);

    expect(error.message).toBe('Too many requests.');
  });

  it.each([
    ['an empty body', {}],
    ['an entry with an unrelated code', { errors: [{ code: 'launch.UNKNOWN_403', message: 'Forbidden' }] }],
    ['an entry with no code', { errors: [{ message: 'Forbidden' }] }],
  ])('words a 403 as needing permission to update the environment for %s', (_label, body) => {
    const error = asPurgeFailure(parseErrorEnvelope(403, body, CACHE_ERROR_MESSAGES)) as LaunchApiError;

    expect(error.message).toBe('Purging the CDN cache needs permission to update the environment.');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
    expect(error.status).toBe(403);
  });

  it('words an environment that is not found as one missing from this project', () => {
    const error = parseErrorEnvelope(404, { errors: [{ code: 'launch.ENVIRONMENT.NOT_FOUND', message: 'x' }] }, CACHE_ERROR_MESSAGES);

    expect(error.message).toBe('No environment with that UID was found in this project.');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });

  it('reports a one-criterion rejection as a bug in the CLI, exiting 1', () => {
    const error = parseErrorEnvelope(400, { errors: [{ code: BUG_CODE }] }, CACHE_ERROR_MESSAGES);

    expect(error.message).toBe(CLI_BUG_MESSAGE);
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });

  it.each([401, 404, 409, 429, 500])('leaves a %i failure exactly as it was', (status) => {
    const failure = parseErrorEnvelope(status, { errors: [{ code: 'launch.X', message: 'kept' }] }, CACHE_ERROR_MESSAGES);

    expect(asPurgeFailure(failure)).toBe(failure);
  });

  it('leaves an error that is not an API failure exactly as it was', () => {
    const failure = new Error('boom');

    expect(asPurgeFailure(failure)).toBe(failure);
  });
});
