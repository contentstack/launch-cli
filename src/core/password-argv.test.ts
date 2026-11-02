import { randomBytes } from 'node:crypto';

import { UsageError } from './errors';
import { PASSWORD_ON_ARGV, refusePasswordOnArgv } from './password-argv';

const password = randomBytes(8).toString('hex');

describe('refusePasswordOnArgv', () => {
  it.each([
    ['-p followed by a value', ['--env', 'staging', '-p', password]],
    ['--password followed by a value', ['--password', password, '--env', 'staging']],
    ['--password=<value>', [`--password=${password}`]],
    ['-p<value> written as one word', [`-p${password}`]],
  ])('refuses %s with a usage error that never repeats the value', (_form, argv) => {
    const refusal = captured(() => refusePasswordOnArgv(argv));

    expect(refusal).toBeInstanceOf(UsageError);
    expect(refusal.message).toBe(PASSWORD_ON_ARGV);
  });

  it.each([
    ['-p last', ['--password-protection', 'enable', '-u', 'admin', '-p']],
    ['-p before another flag', ['-p', '--yes']],
    ['--password before another flag', ['--password', '-u', 'admin']],
  ])('lets %s through, so the password can come from the prompt or standard input', (_form, argv) => {
    expect(() => refusePasswordOnArgv(argv)).not.toThrow();
  });
});

function captured(act: () => void): Error {
  try {
    act();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
