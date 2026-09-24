import { Parser } from '@oclif/core';

import { coreFlags } from './catalog';
import { CLIENT_MAX_LIMIT } from './constants';

async function parse(argv: string[]): Promise<Record<string, unknown>> {
  const { flags } = await Parser.parse(argv, { flags: coreFlags });
  return flags as Record<string, unknown>;
}

describe('coreFlags', () => {
  it('advertises the limit range in the flag itself, not only in the help text', () => {
    expect(coreFlags.limit).toMatchObject({ min: 0, max: CLIENT_MAX_LIMIT });
    expect(coreFlags.limit.description).toBe(`Number of records to fetch (0-${CLIENT_MAX_LIMIT})`);
  });

  it('advertises the skip floor in the flag itself', () => {
    expect(coreFlags.skip).toMatchObject({ min: 0 });
    expect((coreFlags.skip as unknown as { max?: number }).max).toBeUndefined();
  });

  it.each([['0'], ['1'], [String(CLIENT_MAX_LIMIT)]])('accepts the in-range limit %s', async (limit) => {
    await expect(parse(['--limit', limit])).resolves.toMatchObject({ limit: Number(limit) });
  });

  it.each([['-1'], [String(CLIENT_MAX_LIMIT + 1)], ['99999']])('rejects the out-of-range limit %s', async (limit) => {
    await expect(parse(['--limit', limit])).rejects.toThrow(/Expected an integer/);
  });

  it.each([['0'], ['5'], ['1000000']])('accepts the non-negative skip %s', async (skip) => {
    await expect(parse(['--skip', skip])).resolves.toMatchObject({ skip: Number(skip) });
  });

  it.each([['-1'], ['-5']])('rejects the negative skip %s', async (skip) => {
    await expect(parse(['--skip', skip])).rejects.toThrow(/Expected an integer/);
  });

  it('leaves limit and skip absent when neither is passed so the resolution defaults still apply', async () => {
    const flags = await parse([]);

    expect(flags.limit).toBeUndefined();
    expect(flags.skip).toBeUndefined();
  });
});
