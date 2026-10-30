import { EXIT_RUNTIME } from '../core/constants';
import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import { SECRETS_ERROR_MESSAGES, asReadFailure } from './secrets.errors';

const PREFIX = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS';

function failure(status: number, body: unknown): LaunchApiError {
  return parseErrorEnvelope(status, body, SECRETS_ERROR_MESSAGES);
}

describe('SECRETS_ERROR_MESSAGES', () => {
  it.each([
    [`${PREFIX}.KEY.CONFLICT`, 'A secret or a variable with that key already exists in this environment.'],
    [`${PREFIX}.KEY.NOT_FOUND`, 'No secret with that key exists in this environment.'],
    [`${PREFIX}.VALUE.MULTILINE`, 'A secret value must be a single line.'],
    [
      'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE',
      "Another change to this environment's variables and secrets landed at the same moment, so nothing was changed. Run the command again.",
    ],
    ['launch.ENVIRONMENT.NOT_FOUND', 'The project or environment was not found.'],
    ['launch.PROJECT.NOT_FOUND', 'The project or environment was not found.'],
  ])('words %s in the CLI own words, whatever text the API sent', (code, message) => {
    const error = failure(409, { errors: [{ code, message: 'text from the API' }] });

    expect(error.message).toBe(message);
    expect(error.code).toBe(code);
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });
});

describe('asReadFailure', () => {
  it('passes a failure that is not an API error through untouched', () => {
    const error = new Error('socket closed');

    expect(asReadFailure(error)).toBe(error);
  });

  it.each([
    ['an empty body', {}],
    ['an unrelated code', { errors: [{ code: 'launch.UNKNOWN_403', message: 'Forbidden' }] }],
    ['no code', { errors: [{ message: 'Forbidden' }] }],
  ])('words a 403 as needing permission to view the environment for %s', (_label, body) => {
    const error = asReadFailure(failure(403, body)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe('You do not have permission to view the secrets of this environment.');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });

  it.each([
    ['an environment code', { errors: [{ code: 'launch.ENVIRONMENT.NOT_FOUND', message: 'Environment not found.' }] }],
    ['a secret key code', { errors: [{ code: `${PREFIX}.KEY.NOT_FOUND`, message: 'Key not found.' }] }],
    ['an empty body', {}],
    ['no code', { errors: [{ message: 'Not found.' }] }],
  ])('words a 404 as a missing project or environment, never as a missing secret, for %s', (_label, body) => {
    const error = asReadFailure(failure(404, body)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe('The project or environment was not found.');
    expect(error.message).not.toContain('secret');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });

  it.each([
    ['an empty body', {}],
    ['a validation entry', { errors: [{ code: 'launch.ENVIRONMENT.UID.INVALID', message: 'uid echo 123' }] }],
  ])('words a 400 as a rejected read without repeating the API text for %s', (_label, body) => {
    const error = asReadFailure(failure(400, body)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('The Launch API rejected the request to list the secrets of this environment.');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });

  it.each([401, 429, 500, 502])('leaves a %i as the API error it already is', (status) => {
    const error = failure(status, { errors: [{ code: 'launch.SOMETHING', message: 'text' }] });

    expect(asReadFailure(error)).toBe(error);
  });
});
