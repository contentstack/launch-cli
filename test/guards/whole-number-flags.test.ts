import { occurrences, productionSources } from '../support/sources';

describe('guard: number flags give one readable sentence when the value is wrong', () => {
  it('declares no Flags.integer in src, so a bad number never prints oclif\'s "Parsing --flag" text', () => {
    const offenders = productionSources()
      .flatMap((source) => occurrences(source, /\bFlags\.integer\s*\(/))
      .map((hit) => `src/${hit.path}:${hit.line} ${hit.text}`);

    expect(offenders).toEqual([]);
  });
});
