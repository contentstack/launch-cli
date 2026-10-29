import { randomUUID } from 'crypto';

import {
  CLIENT_EXPOSED_PREFIXES,
  clientExposedWarning,
  isClientExposedKey,
  formatSecretsError,
  redactFlagValues,
} from './secrets';

const apiError = (status: number, code?: string, message = 'Request failed') => ({
  graphQLErrors: [{ message, extensions: { exception: { status, ...(code ? { name: code } : {}) } } }],
  message,
});

describe('secrets util', () => {
  it.each(CLIENT_EXPOSED_PREFIXES)('flags a key starting with %s as client exposed and warns about it', (prefix) => {
    const key = `${prefix}API_URL`;

    const exposed = isClientExposedKey(key);
    const warning = clientExposedWarning(key);

    expect(exposed).toBe(true);
    expect(warning).toContain(key);
    expect(warning).toContain('inlined into client JavaScript at build time');
  });

  it.each(['API_TOKEN', 'MY_NEXT_PUBLIC_X', 'next_public_x'])('does not flag %s as client exposed', (key) => {
    expect(isClientExposedKey(key)).toBe(false);
  });

  it('lists the five client exposed prefixes', () => {
    expect(CLIENT_EXPOSED_PREFIXES).toEqual(['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_']);
  });

  it.each([
    ['409 key conflict', apiError(409, 'ENVIRONMENT_SECRET_KEY_CONFLICT'), 'already used by a variable or secret'],
    ['409 concurrent update', apiError(409, 'ENVIRONMENT_VARIABLES_CONCURRENT_UPDATE'), 'concurrent update'],
    ['400 multiline', apiError(400, 'ENVIRONMENT_SECRET_VALUE_MULTILINE'), 'multi-line values are not supported'],
    ['400 invalid', apiError(400), 'invalid key or value'],
    ['403', apiError(403), 'do not have permission'],
    ['404 not found', apiError(404, 'ENVIRONMENT_SECRET_NOT_FOUND'), 'DB_URL was not found'],
  ])('formats a %s API error as a clear message', (_label, error, expected) => {
    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain(expected);
  });

  it('produces distinct messages for each known error', () => {
    const errors = [
      apiError(409, 'ENVIRONMENT_SECRET_KEY_CONFLICT'),
      apiError(409, 'ENVIRONMENT_VARIABLES_CONCURRENT_UPDATE'),
      apiError(400, 'ENVIRONMENT_SECRET_VALUE_MULTILINE'),
      apiError(400),
      apiError(403),
      apiError(404, 'ENVIRONMENT_SECRET_NOT_FOUND'),
    ];

    const messages = errors.map((error) => formatSecretsError(error, { key: 'DB_URL' }));

    expect(new Set(messages).size).toBe(messages.length);
    messages.forEach((message) => expect(message.length).toBeGreaterThan(0));
  });

  it('finds a namespaced code in the error object', () => {
    const error = {
      graphQLErrors: [
        {
          message: 'Conflict',
          extensions: { exception: { status: 409, errorObject: { code: 'launch.ENVIRONMENT_SECRET_KEY_CONFLICT' } } },
        },
      ],
    };

    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain('already used by a variable or secret');
  });

  it('finds a code in the exception messages', () => {
    const error = {
      graphQLErrors: [
        { message: 'Bad', extensions: { exception: { status: 400, messages: ['ENVIRONMENT_SECRET_VALUE_MULTILINE'] } } },
      ],
    };

    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain('multi-line values are not supported');
  });

  it('finds a code in the top level error message', () => {
    const error = { message: 'ENVIRONMENT_SECRET_NOT_FOUND', graphQLErrors: [] };

    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain('DB_URL was not found');
  });

  it('falls back to the server message for an unknown error', () => {
    const message = formatSecretsError(apiError(500, 'SOMETHING_ELSE', 'Server exploded'), { key: 'DB_URL' });

    expect(message).toBe('Server exploded');
  });

  it('never includes the secret value in the message', () => {
    const value = randomUUID();

    const message = formatSecretsError(apiError(500, undefined, `bad value ${value}`), { key: 'DB_URL', value });

    expect(message).not.toContain(value);
  });

  it('removes the value of an equals-style flag from a parse error message', () => {
    const value = randomUUID();

    const message = redactFlagValues(`Nonexistent flag: --value=${value}\nSee more help with --help`);

    expect(message).toBe('Nonexistent flag: --value\nSee more help with --help');
  });

  it('leaves a message without flag values unchanged', () => {
    expect(redactFlagValues('Missing required flag key')).toBe('Missing required flag key');
  });
});
