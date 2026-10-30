import { randomUUID } from 'node:crypto';

import { Errors, Parser } from '@oclif/core';

import { UsageError } from '../core/errors';
import { catalog } from '../resources';
import {
  CLIENT_EXPOSED_PREFIXES,
  INVALID_ARGUMENTS_MESSAGE,
  UNSET_INVALID_ARGUMENTS_MESSAGE,
  asSafeArgvFailure,
  clientExposedPrefix,
  clientExposedWarning,
  emptyValueError,
  singleKeyError,
} from './secret.rules';

describe('CLIENT_EXPOSED_PREFIXES', () => {
  it('lists the five public prefixes the story names, in order', () => {
    expect([...CLIENT_EXPOSED_PREFIXES]).toEqual(['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_']);
  });
});

describe('clientExposedPrefix', () => {
  it.each(CLIENT_EXPOSED_PREFIXES.map((prefix) => [prefix]))('finds %s at the start of a key', (prefix) => {
    expect(clientExposedPrefix(`${prefix}TOKEN`)).toBe(prefix);
    expect(clientExposedPrefix(prefix)).toBe(prefix);
  });

  it.each([
    ['API_TOKEN'],
    ['MY_NEXT_PUBLIC_X'],
    ['NEXT_PUBLIC'],
    ['next_public_x'],
    ['VITE'],
    ['XPUBLIC_X'],
    [''],
  ])('finds none in %p', (key) => {
    expect(clientExposedPrefix(key)).toBeUndefined();
  });
});

describe('clientExposedWarning', () => {
  it.each(CLIENT_EXPOSED_PREFIXES.map((prefix) => [prefix]))(
    'names the key and the prefix and says the value is inlined into client JavaScript at build time for %s',
    (prefix) => {
      const key = `${prefix}ANALYTICS`;

      expect(clientExposedWarning(key)).toBe(
        `Warning: ${key} starts with ${prefix}, so its value is inlined into client JavaScript at build time ` +
          'and is readable by anyone who loads the site. Do not keep a credential under this name.',
      );
    },
  );

  it.each([['API_TOKEN'], ['MY_NEXT_PUBLIC_X']])('is undefined for %s', (key) => {
    expect(clientExposedWarning(key)).toBeUndefined();
  });
});

describe('emptyValueError', () => {
  it('is a usage error that names the key and says nothing was changed', () => {
    const error = emptyValueError('API_TOKEN');

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('The value for API_TOKEN is empty. A secret needs a non-empty value; nothing was changed.');
  });
});

describe('singleKeyError', () => {
  it('asks for --key when none was given', () => {
    const error = singleKeyError(0);

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('Missing required value for --key. Pass --key.');
  });

  it.each([[2], [3]])('says one secret at a time for %i keys', (count) => {
    const error = singleKeyError(count);

    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('launch:secrets:set sets one secret at a time. Pass --key once.');
  });
});

describe('asSafeArgvFailure', () => {
  const secret = randomUUID();
  async function realParseFailure(argv: string[]): Promise<unknown> {
    return Parser.parse(argv, { flags: { key: catalog.key, yes: catalog.yes }, strict: true }).catch(
      (error: unknown) => error,
    );
  }

  it.each([
    ['an unexpected positional', ['--key', 'K', '--', secret], true],
    ['an unknown long flag with =', [`--value=${secret}`], true],
    ['an unknown long flag', ['--value', secret], false],
    ['an unknown short flag with an attached value', [`-v${secret}`], true],
  ])('replaces the real oclif parse error for %s by a generic usage error that carries no argv token', async (_label, argv, echoed) => {
    const raw = await realParseFailure(argv);

    expect(raw).toBeInstanceOf(Errors.CLIError);
    expect((raw as Error).message.includes(secret)).toBe(echoed);

    const safe = asSafeArgvFailure(raw) as UsageError;

    expect(safe).toBeInstanceOf(UsageError);
    expect(safe.exitCode).toBe(2);
    expect(safe.message).toBe(INVALID_ARGUMENTS_MESSAGE);
    expect(safe.message).not.toContain(secret);
  });

  it('leaves a CLI error that is not a parse error as it is', () => {
    const error = new Errors.CLIError(`plain ${secret}`);

    expect(asSafeArgvFailure(error)).toBe(error);
  });

  it('leaves an error that is not a CLI error as it is', () => {
    const error = new Error('boom');

    expect(asSafeArgvFailure(error)).toBe(error);
  });

  it('leaves a value that is not an error as it is', () => {
    expect(asSafeArgvFailure('text')).toBe('text');
  });

  it('words the replacement with the message it is given, never an argv token', async () => {
    const raw = await realParseFailure([`--value=${secret}`]);

    const safe = asSafeArgvFailure(raw, UNSET_INVALID_ARGUMENTS_MESSAGE) as UsageError;

    expect(safe).toBeInstanceOf(UsageError);
    expect(safe.exitCode).toBe(2);
    expect(safe.message).toBe(UNSET_INVALID_ARGUMENTS_MESSAGE);
    expect(safe.message).not.toContain(secret);
  });
});

describe('UNSET_INVALID_ARGUMENTS_MESSAGE', () => {
  it('names launch:secrets:unset and the flags it takes, and is not the set wording', () => {
    expect(UNSET_INVALID_ARGUMENTS_MESSAGE).toBe(
      'Invalid arguments. Run csdx launch:secrets:unset --help to see the accepted flags. ' +
        'Pass each secret as --key <KEY>, not as a bare argument.',
    );
    expect(UNSET_INVALID_ARGUMENTS_MESSAGE).not.toBe(INVALID_ARGUMENTS_MESSAGE);
  });
});
