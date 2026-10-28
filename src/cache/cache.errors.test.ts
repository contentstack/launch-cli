import { EXIT_RUNTIME } from '../core/constants';
import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import { CACHE_ERROR_MESSAGES, asPurgeFailure } from './cache.errors';

const QUOTA_CODE = 'launch.ORGANIZATION.REVALIDATE_RATE_LIMIT_EXCEEDED';
const QUOTA_MESSAGE = "You have reached today's cache revalidation limit for this organization. It resets at 00:00 UTC.";
const FAILED_MESSAGE = 'Failed to start cache revalidation. Try again.';
const CLI_BUG_MESSAGE = 'The CLI sent a purge request the Launch API could not accept. This is a bug in the CLI.';
const BUG_CODE = 'launch.ENVIRONMENT.REVALIDATE_CDN_CACHE.INVALID_INPUT.ONLY_ONE_OF_CACHEPATH_CACHETAGS_HOSTNAMES_ALLOWED';

describe('CACHE_ERROR_MESSAGES', () => {
  it('words the daily purge quota 429 as the limit and when it resets, exiting 1', () => {
    const error = parseErrorEnvelope(429, { errors: [{ code: QUOTA_CODE, message: 'Rate limit exceeded' }] }, CACHE_ERROR_MESSAGES);

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.message).toBe(QUOTA_MESSAGE);
    expect(error.exitCode).toBe(EXIT_RUNTIME);
    expect(asPurgeFailure(error)).toBe(error);
  });

  it.each([
    [500, { errors: [{ code: 'launch.INTERNAL', message: 'database down' }] }],
    [409, { errors: [{ code: 'launch.CONFLICT', message: 'conflict text' }] }],
    [429, { errors: [{ code: 'launch.RATE_LIMITED', message: 'Too many requests.' }] }],
    [400, { errors: [{ code: 'launch.OTHER', message: 'bad input' }] }],
    [502, {}],
    [500, { errors: [{ code: 'constructor', message: 'inherited key' }] }],
  ])('words a %i from the purge as a failure to start the revalidation, exiting 1', (status, body) => {
    const error = asPurgeFailure(parseErrorEnvelope(status, body, CACHE_ERROR_MESSAGES)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.message).toBe(FAILED_MESSAGE);
    expect(error.status).toBe(status);
    expect(error.exitCode).toBe(EXIT_RUNTIME);
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

  it('leaves a 401 failure exactly as it was', () => {
    const failure = parseErrorEnvelope(401, { errors: [{ code: 'launch.X', message: 'kept' }] }, CACHE_ERROR_MESSAGES);

    expect(asPurgeFailure(failure)).toBe(failure);
  });

  it('leaves the environment not-found failure exactly as it was', () => {
    const failure = parseErrorEnvelope(404, { errors: [{ code: 'launch.ENVIRONMENT.NOT_FOUND' }] }, CACHE_ERROR_MESSAGES);

    expect(asPurgeFailure(failure)).toBe(failure);
    expect(failure.message).toBe('No environment with that UID was found in this project.');
  });

  it('leaves the CLI-bug rejection exactly as it was', () => {
    const failure = parseErrorEnvelope(400, { errors: [{ code: BUG_CODE }] }, CACHE_ERROR_MESSAGES);

    expect(asPurgeFailure(failure)).toBe(failure);
  });

  it('leaves an error that is not an API failure exactly as it was', () => {
    const failure = new Error('boom');

    expect(asPurgeFailure(failure)).toBe(failure);
  });
});
