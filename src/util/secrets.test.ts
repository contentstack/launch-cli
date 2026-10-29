import { randomUUID } from 'crypto';

import {
  CLIENT_EXPOSED_PREFIXES,
  clientExposedWarning,
  isClientExposedKey,
  formatSecretsError,
  redactFlagValues,
} from './secrets';

const CODES = {
  conflict: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.CONFLICT',
  notFound: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND',
  multiline: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.VALUE.MULTILINE',
  concurrent: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE',
  keyEmpty: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_EMPTY',
  keyTooLong: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.TOO_LONG',
  valueEmpty: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.NOT_EMPTY',
  valueTooLong: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.TOO_LONG',
};

const formError = (code: string, key = 'secret') => ({
  message: 'Bad request',
  graphQLErrors: [
    {
      message: 'Bad request',
      extensions: {
        exception: { status: 400, messages: [code], errorObject: { [key]: [{ code }] } },
      },
    },
  ],
});

const apiError = (status: number, message = 'Request failed') => ({
  graphQLErrors: [{ message, extensions: { exception: { status } } }],
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
    ['key conflict', formError(CODES.conflict), 'already used by a variable or secret'],
    ['concurrent update', formError(CODES.concurrent, 'environmentVariables'), 'concurrent update'],
    ['multiline', formError(CODES.multiline), 'multi-line values are not supported'],
    ['not found', formError(CODES.notFound), 'DB_URL was not found'],
    ['empty key', formError(CODES.keyEmpty), 'key cannot be empty'],
    ['too long key', formError(CODES.keyTooLong), 'key is too long'],
    ['empty value', formError(CODES.valueEmpty), 'value cannot be empty'],
    ['too long value', formError(CODES.valueTooLong), 'value is too long'],
    ['plain 400 validation', apiError(400), 'invalid key or value'],
    ['403', apiError(403), 'do not have permission'],
  ])('formats a %s API error as a clear message', (_label, error, expected) => {
    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain(expected);
  });

  it.each([
    [404, 'The project or environment was not found.'],
    [400, 'The API rejected the request.'],
  ])('uses read-context wording without a key for a %i on a read operation', (status, expected) => {
    const message = formatSecretsError(apiError(status), { operation: 'read' });

    expect(message).toBe(expected);
    expect(message).not.toContain('the secret');
  });

  it('keeps the key-specific wording for a write operation', () => {
    const message = formatSecretsError(formError(CODES.notFound), { key: 'DB_URL', operation: 'write' });

    expect(message).toBe('The secret DB_URL was not found.');
  });

  it('produces distinct messages for each known error', () => {
    const errors = [
      formError(CODES.conflict),
      formError(CODES.concurrent),
      formError(CODES.multiline),
      formError(CODES.notFound),
      formError(CODES.keyEmpty),
      formError(CODES.keyTooLong),
      formError(CODES.valueEmpty),
      formError(CODES.valueTooLong),
      apiError(400),
      apiError(403),
    ];

    const messages = errors.map((error) => formatSecretsError(error, { key: 'DB_URL' }));

    expect(new Set(messages).size).toBe(messages.length);
    messages.forEach((message) => expect(message.length).toBeGreaterThan(0));
  });

  it('finds a code in the error object only', () => {
    const error = {
      graphQLErrors: [
        {
          message: 'Bad request',
          extensions: { exception: { status: 400, errorObject: { secret: [{ code: CODES.conflict }] } } },
        },
      ],
    };

    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain('already used by a variable or secret');
  });

  it('finds a code in the exception messages', () => {
    const error = {
      graphQLErrors: [
        { message: 'Bad', extensions: { exception: { status: 400, messages: [CODES.multiline] } } },
      ],
    };

    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain('multi-line values are not supported');
  });

  it('finds a code in the top level error message', () => {
    const error = { message: CODES.notFound, graphQLErrors: [] };

    const message = formatSecretsError(error, { key: 'DB_URL' });

    expect(message).toContain('DB_URL was not found');
  });

  it('falls back to the server message for an unknown error', () => {
    const message = formatSecretsError(apiError(500, 'Server exploded'), { key: 'DB_URL' });

    expect(message).toBe('Server exploded');
  });

  it('never includes the secret value in the message', () => {
    const value = randomUUID();

    const message = formatSecretsError(apiError(500, `bad value ${value}`), { key: 'DB_URL', value });

    expect(message).not.toContain(value);
  });

  it('removes the value of an equals-style flag from a parse error message', () => {
    const value = randomUUID();

    const message = redactFlagValues(`Nonexistent flag: --value=${value}\nSee more help with --help`);

    expect(message).toBe('Nonexistent flag: --value\nSee more help with --help');
  });

  it('removes a spaced value of an equals-style flag up to the end of the line', () => {
    const value = `${randomUUID()} ${randomUUID()}`;

    const message = redactFlagValues(`Nonexistent flag: --value=${value}\nSee more help with --help`);

    expect(message).toBe('Nonexistent flag: --value\nSee more help with --help');
  });

  it('removes the value of a short equals-style flag', () => {
    const value = `${randomUUID()} ${randomUUID()}`;

    const message = redactFlagValues(`Nonexistent flag: -v=${value}`);

    expect(message).toBe('Nonexistent flag: -v');
  });

  it('leaves a message without flag values unchanged', () => {
    expect(redactFlagValues('Missing required flag key')).toBe('Missing required flag key');
  });
});
