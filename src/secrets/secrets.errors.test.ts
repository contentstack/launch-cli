import { randomUUID } from 'node:crypto';

import { EXIT_RUNTIME } from '../core/constants';
import { SessionExpiredError } from '../core/errors';
import { LaunchApiError, LaunchNetworkError, parseErrorEnvelope } from '../transport/errors';
import { SECRETS_ERROR_MESSAGES, SecretInputTimeoutError, SecretsNotRemovedError, asReadFailure, asWriteFailure } from './secrets.errors';

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

describe('asWriteFailure', () => {
  it.each([
    ['a 409 conflict', 409, `${PREFIX}.KEY.CONFLICT`, 'A secret or a variable with that key already exists in this environment.'],
    [
      'a 409 concurrent update',
      409,
      'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE',
      "Another change to this environment's variables and secrets landed at the same moment, so nothing was changed. Run the command again.",
    ],
    ['a 400 multiline value', 400, `${PREFIX}.VALUE.MULTILINE`, 'A secret value must be a single line.'],
    ['a 404 secret not found', 404, `${PREFIX}.KEY.NOT_FOUND`, 'No secret with that key exists in this environment.'],
    ['a 404 environment not found', 404, 'launch.ENVIRONMENT.NOT_FOUND', 'The project or environment was not found.'],
  ])('keeps the catalog wording and the code for %s', (_label, status, code, message) => {
    const error = asWriteFailure(failure(status, { errors: [{ code, message: 'text from the API' }] }), randomUUID());

    expect(error).toBeInstanceOf(LaunchApiError);
    expect((error as LaunchApiError).status).toBe(status);
    expect((error as LaunchApiError).code).toBe(code);
    expect((error as LaunchApiError).message).toBe(message);
    expect((error as LaunchApiError).exitCode).toBe(EXIT_RUNTIME);
  });

  it.each([
    ['an unrelated code', { errors: [{ code: 'launch.RBAC.FORBIDDEN', message: 'raw forbidden text' }] }],
    ['an empty body', {}],
  ])('words a 403 as needing permission to change the secrets, not to view them, for %s', (_label, body) => {
    const error = asWriteFailure(failure(403, body), randomUUID()) as LaunchApiError;

    expect(error.status).toBe(403);
    expect(error.message).toBe('You do not have permission to change the secrets of this environment.');
    expect(error.message).not.toContain('view');
  });

  it.each([
    ['an unrelated code', { errors: [{ code: 'launch.SOMETHING', message: 'Not found.' }] }],
    ['an empty body', {}],
  ])('words a 404 with no catalog code as a missing project, environment or secret for %s', (_label, body) => {
    const error = asWriteFailure(failure(404, body), randomUUID()) as LaunchApiError;

    expect(error.status).toBe(404);
    expect(error.message).toBe('The project, the environment or the secret was not found.');
  });

  it('shows the API wording of a 400 validation entry that is not in the catalog', () => {
    const error = asWriteFailure(
      failure(400, { errors: [{ code: 'launch.ENVIRONMENT.KEY.INVALID', message: 'key must be a valid name' }] }),
      randomUUID(),
    ) as LaunchApiError;

    expect(error.status).toBe(400);
    expect(error.code).toBe('launch.ENVIRONMENT.KEY.INVALID');
    expect(error.message).toBe('key must be a valid name');
  });

  it('words a field-named 400 from its field and code, as the read path does', () => {
    const error = asWriteFailure(
      failure(400, { errors: [{ value: { code: 'launch.ENVIRONMENT.VALUE.TOO_LONG', message: 'Bad request' } }] }),
      randomUUID(),
    ) as LaunchApiError;

    expect(error.message).toBe('The Launch API rejected the request: value: launch.ENVIRONMENT.VALUE.TOO_LONG');
  });

  it('strips the value, and its trimmed form, from every API text an error carries', () => {
    const secret = randomUUID();
    const padded = `  ${secret}  `;
    const error = asWriteFailure(
      failure(400, {
        errors: [
          { code: 'launch.X.ONE', message: `value ${padded} is bad and ${secret} again` },
          { code: 'launch.X.TWO' },
        ],
      }),
      padded,
    ) as LaunchApiError;

    expect(error.message).toBe('value •••••• is bad and •••••• again');
    expect(error.errors).toEqual([{ code: 'launch.X.ONE', message: 'value •••••• is bad and •••••• again' }, { code: 'launch.X.TWO' }]);
    expect(JSON.stringify(error.errors)).not.toContain(secret);
  });

  it('does not touch the text of an error when the value is empty', () => {
    const error = asWriteFailure(failure(400, { errors: [{ code: 'launch.X', message: 'plain text' }] }), '') as LaunchApiError;

    expect(error.message).toBe('plain text');
  });

  it('keeps the fixed catalog wording even when the value is a piece of it', () => {
    const error = asWriteFailure(
      failure(409, { errors: [{ code: `${PREFIX}.KEY.CONFLICT`, message: 'x' }] }),
      'secret',
    ) as LaunchApiError;

    expect(error.message).toBe('A secret or a variable with that key already exists in this environment.');
  });

  it('rebuilds a network error without its cause and with the value stripped from its message', () => {
    const secret = randomUUID();
    const cause = new Error(`request body ${secret}`);
    const error = asWriteFailure(new LaunchNetworkError(`Could not send ${secret}`, cause, true), secret) as LaunchNetworkError;

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect(error.message).toBe('Could not send ••••••');
    expect(error.cause).toBeUndefined();
    expect(error.retryable).toBe(true);
  });

  it('keeps a network error that was not retryable not retryable', () => {
    const error = asWriteFailure(new LaunchNetworkError('proxy down', new Error('x')), randomUUID()) as LaunchNetworkError;

    expect(error.retryable).toBe(false);
  });

  it('passes another CLI error, which carries only CLI wording, through untouched', () => {
    const error = new SessionExpiredError();

    expect(asWriteFailure(error, randomUUID())).toBe(error);
  });

  it('replaces a plain error by one with the value stripped and no cause or stack from the original', () => {
    const secret = randomUUID();
    const original = Object.assign(new Error(`boom ${secret}`), { cause: secret });
    const error = asWriteFailure(original, secret) as Error;

    expect(error).not.toBe(original);
    expect(error.message).toBe('boom ••••••');
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(error.stack).not.toContain(secret);
  });

  it('returns a thrown value that is not an error as it is', () => {
    expect(asWriteFailure('text', randomUUID())).toBe('text');
  });
});

describe('SecretInputTimeoutError', () => {
  it('uses the singular for one second', () => {
    expect(new SecretInputTimeoutError(1).message).toContain('within 1 second, so');
  });

  it('says how long it waited and that nothing changed, exiting 1', () => {
    const error = new SecretInputTimeoutError(30);

    expect(error.name).toBe('SecretInputTimeoutError');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
    expect(error.message).toBe(
      'No value arrived on standard input within 30 seconds, so nothing was changed. ' +
        'Pipe the value in, for example: printf \'%s\' "$TOKEN" | csdx launch:secrets:set --key <KEY> --yes',
    );
  });
});

describe('SecretsNotRemovedError', () => {
  it.each([
    [['A'], 1, '1 of 1 secret was not removed: A.'],
    [['A', 'B'], 2, '2 of 2 secrets were not removed: A, B.'],
    [['B'], 3, '1 of 3 secrets were not removed: B.'],
  ])('names the keys that stayed and counts them against the request (%p of %i)', (keys, total, message) => {
    const error = new SecretsNotRemovedError(keys, total);

    expect(error.name).toBe('SecretsNotRemovedError');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
    expect(error.message).toBe(message);
  });
});
