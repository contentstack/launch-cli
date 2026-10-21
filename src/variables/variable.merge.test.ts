import { mergeSources } from './variable.merge';

const STACK = { label: 'stack', variables: [{ key: 'API_URL', value: 'from-stack' }, { key: 'REGION', value: 'eu' }] };
const FILE = { label: '.env', variables: [{ key: 'DEBUG', value: 'file' }, { key: 'REGION', value: 'us' }] };
const VAR = { label: '--var', variables: [{ key: 'API_URL', value: 'from-var' }] };

describe('variable merge', () => {
  it('lets a later source win a collision, keeping each key where it first appeared', () => {
    const merged = mergeSources([STACK, FILE, VAR]);

    expect(merged.variables).toEqual([
      { key: 'API_URL', value: 'from-var' },
      { key: 'REGION', value: 'us' },
      { key: 'DEBUG', value: 'file' },
    ]);
  });

  it('counts only the keys a source added that no earlier source had', () => {
    const merged = mergeSources([STACK, FILE, VAR]);

    expect(merged.added).toEqual([
      { label: 'stack', count: 2 },
      { label: '.env', count: 1 },
    ]);
  });

  it('names every key a later source overrode, grouped by the overriding source', () => {
    const merged = mergeSources([STACK, FILE, VAR]);

    expect(merged.overrides).toEqual([
      { label: '.env', keys: ['REGION'] },
      { label: '--var', keys: ['API_URL'] },
    ]);
  });

  it('takes the last occurrence of a key repeated inside one source without calling it an override', () => {
    const merged = mergeSources([
      { label: '--var', variables: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }, { key: 'A', value: '3' }] },
    ]);

    expect(merged.variables).toEqual([
      { key: 'A', value: '3' },
      { key: 'B', value: '2' },
    ]);
    expect(merged.added).toEqual([{ label: '--var', count: 2 }]);
    expect(merged.overrides).toEqual([]);
  });

  it('reports a source that adds nothing new only through its overrides', () => {
    const merged = mergeSources([STACK, VAR]);

    expect(merged.added).toEqual([{ label: 'stack', count: 2 }]);
    expect(merged.overrides).toEqual([{ label: '--var', keys: ['API_URL'] }]);
  });

  it('returns nothing for no sources and for sources with no variables', () => {
    expect(mergeSources([])).toEqual({ variables: [], added: [], overrides: [] });
    expect(mergeSources([{ label: '.env', variables: [] }])).toEqual({ variables: [], added: [], overrides: [] });
  });

  it('does not alter the sources it was given', () => {
    const file = { label: '.env', variables: [{ key: 'A', value: '1' }] };
    const snapshot = JSON.parse(JSON.stringify(file));

    mergeSources([STACK, file, VAR]);

    expect(file).toEqual(snapshot);
  });

  it('treats keys as case-sensitive', () => {
    const merged = mergeSources([{ label: '--var', variables: [{ key: 'a', value: '1' }, { key: 'A', value: '2' }] }]);

    expect(merged.variables).toEqual([{ key: 'a', value: '1' }, { key: 'A', value: '2' }]);
  });
});
