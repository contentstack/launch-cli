import { Parser } from '@oclif/core';

import { coreFlags } from './catalog';
import { CLIENT_MAX_LIMIT } from './constants';
import { FlagValueError } from './errors';

async function parse(argv: string[]): Promise<Record<string, unknown>> {
  const { flags } = await Parser.parse(argv, { flags: coreFlags });
  return flags as Record<string, unknown>;
}

describe('coreFlags', () => {
  it('gives --yes no short flag', () => {
    expect(coreFlags.yes.char).toBeUndefined();
  });

  it('still parses --yes as true', async () => {
    await expect(parse(['--yes'])).resolves.toMatchObject({ yes: true });
  });

  it('rejects -y at parse time rather than reading it as --yes', async () => {
    await expect(parse(['-y'])).rejects.toThrow(/Nonexistent flag: -y/);
  });

  it('gives --config no short flag', () => {
    expect(coreFlags.config.char).toBeUndefined();
  });

  it('still parses --config with its value', async () => {
    await expect(parse(['--config', './.cs-launch.json'])).resolves.toMatchObject({ config: './.cs-launch.json' });
  });

  it('rejects -c at parse time rather than reading it as --config', async () => {
    await expect(parse(['-c', './.cs-launch.json'])).rejects.toThrow(/Nonexistent flag: -c/);
  });

  it('advertises the limit range in the help text', () => {
    expect(coreFlags.limit.description).toBe(`Number of records to fetch (1-${CLIENT_MAX_LIMIT})`);
  });

  it.each([['1'], ['2'], [String(CLIENT_MAX_LIMIT)], [' 7 ']])('accepts the in-range limit %p', async (limit) => {
    await expect(parse(['--limit', limit])).resolves.toMatchObject({ limit: Number(limit) });
  });

  it.each([['0'], ['-1'], [String(CLIENT_MAX_LIMIT + 1)], ['99999'], ['abc'], ['1.5'], ['1e2'], ['0x10'], [''], [' ']])(
    'rejects the limit %p with one sentence naming the flag and its range',
    async (limit) => {
      const failure = await parse(['--limit', limit]).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(FlagValueError);
      expect((failure as FlagValueError).detail).toBe(
        `Invalid --limit value "${limit}". Provide a whole number from 1 to ${CLIENT_MAX_LIMIT}.`,
      );
    },
  );

  it.each([['0'], ['5'], ['1000000']])('accepts the non-negative skip %s', async (skip) => {
    await expect(parse(['--skip', skip])).resolves.toMatchObject({ skip: Number(skip) });
  });

  it.each([['-1'], ['-5'], ['abc'], ['2.5']])(
    'rejects the skip %p with one sentence naming the flag and its floor',
    async (skip) => {
      const failure = await parse(['--skip', skip]).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(FlagValueError);
      expect((failure as FlagValueError).detail).toBe(
        `Invalid --skip value "${skip}". Provide a whole number of 0 or more.`,
      );
    },
  );

  it('leaves limit and skip absent when neither is passed so the resolution defaults still apply', async () => {
    const flags = await parse([]);

    expect(flags.limit).toBeUndefined();
    expect(flags.skip).toBeUndefined();
  });
});
