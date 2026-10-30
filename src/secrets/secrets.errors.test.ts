import { LaunchApiError } from '../transport/errors';
import { SECRETS_ERROR_MESSAGES, secretKeyMessages } from './secrets.errors';

const PREFIX = 'launch.ENVIRONMENT.';

describe('secrets error wording', () => {
  it.each([
    [
      409,
      `${PREFIX}ENVIRONMENT_SECRETS.KEY.CONFLICT`,
      'The key DB_URL is already used by a variable or a secret in this environment.',
    ],
    [
      409,
      `${PREFIX}ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE`,
      'The environment was changed by another request at the same moment. Run the command again.',
    ],
    [400, `${PREFIX}ENVIRONMENT_SECRETS.VALUE.MULTILINE`, 'Invalid value: a secret value cannot contain line breaks.'],
    [400, `${PREFIX}ENVIRONMENT_VARIABLES.KEY.NOT_EMPTY`, 'Invalid key: the key cannot be empty.'],
    [400, `${PREFIX}ENVIRONMENT_VARIABLES.KEY.NOT_STRING`, 'Invalid key: the key must be text.'],
    [400, `${PREFIX}ENVIRONMENT_VARIABLES.KEY.TOO_LONG`, 'Invalid key: the key is too long.'],
    [400, `${PREFIX}ENVIRONMENT_VARIABLES.VALUE.NOT_EMPTY`, 'Invalid value: the value cannot be empty.'],
    [400, `${PREFIX}ENVIRONMENT_VARIABLES.VALUE.NOT_STRING`, 'Invalid value: the value must be text.'],
    [400, `${PREFIX}ENVIRONMENT_VARIABLES.VALUE.TOO_LONG`, 'Invalid value: the value is too long.'],
    [404, `${PREFIX}ENVIRONMENT_SECRETS.KEY.NOT_FOUND`, 'The secret DB_URL was not found in this environment.'],
    [404, `${PREFIX}NOT_FOUND`, 'No environment found with that name or UID.'],
  ])('words %i %s as a distinct message naming the key', (status, code, message) => {
    const failure = new LaunchApiError(status, [{ code, message: 'raw server text' }], secretKeyMessages('DB_URL'));

    expect(failure.message).toBe(message);
  });

  it('keeps the server wording for a code it does not reword', () => {
    const failure = new LaunchApiError(
      400,
      [{ code: 'launch.SOMETHING.NEW', message: 'raw server text' }],
      secretKeyMessages('DB_URL'),
    );

    expect(failure.message).toBe('raw server text');
  });

  it('keeps the read-context messages free of any key', () => {
    expect(Object.values(SECRETS_ERROR_MESSAGES).join(' ')).not.toContain('DB_URL');
  });
});
