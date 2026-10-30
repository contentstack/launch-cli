import { randomUUID } from 'node:crypto';

import { GENERIC_ARGUMENTS_MESSAGE, withoutArgumentValues } from './secrets.redact';

function failure(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at somewhere (file.ts:1:1)`;
  return error;
}

describe('withoutArgumentValues', () => {
  it('drops the value of a --flag=value pair from the message and the stack', () => {
    const value = randomUUID();

    const error = withoutArgumentValues(failure(`Nonexistent flag: --value=${value}\nSee more help with --help`));

    expect(error.message).toBe('Nonexistent flag: --value\nSee more help with --help');
    expect(error.stack).toBe(
      'Error: Nonexistent flag: --value\nSee more help with --help\n    at somewhere (file.ts:1:1)',
    );
    expect(`${error.message}${error.stack}`).not.toContain(value);
  });

  it('drops a short flag value too, whatever it contains', () => {
    const error = withoutArgumentValues(failure('Nonexistent flag: -v=a b=c d'));

    expect(error.message).toBe('Nonexistent flag: -v');
  });

  it.each([['Unexpected argument: VALUE'], ['Unexpected arguments: A, B']])(
    'replaces %p with the generic invalid-arguments message',
    (line) => {
      const error = withoutArgumentValues(failure(`${line}\nSee more help with --help`));

      expect(error.message).toBe(`${GENERIC_ARGUMENTS_MESSAGE}\nSee more help with --help`);
      expect(error.stack).toContain(GENERIC_ARGUMENTS_MESSAGE);
      expect(error.stack).not.toContain('VALUE');
    },
  );

  it('leaves a message with no argument value untouched, and returns the same error', () => {
    const original = failure('Nonexistent flag: --value\nSee more help with --help');

    const error = withoutArgumentValues(original);

    expect(error).toBe(original);
    expect(error.message).toBe('Nonexistent flag: --value\nSee more help with --help');
  });

  it('leaves a hyphenated word that is not a flag assignment alone', () => {
    const error = withoutArgumentValues(failure('a well-known=thing'));

    expect(error.message).toBe('a well-known=thing');
  });

  it('keeps an error with no stack free of one', () => {
    const original = new Error('Nonexistent flag: --value=x');
    original.stack = undefined;

    expect(withoutArgumentValues(original).stack).toBeUndefined();
  });
});
