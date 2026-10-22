import { variablesSetLine } from './variable.summary';

describe('variable summary', () => {
  it('names the total, every source that added keys and every override', () => {
    const line = variablesSetLine(
      {
        variables: new Array(18).fill({ key: 'K', value: 'v' }),
        added: [
          { label: 'stack', count: 12 },
          { label: '.env', count: 6 },
        ],
        overrides: [{ label: '--var', keys: ['API_URL'] }],
      },
      false,
    );

    expect(line).toBe('✔ 18 variables set — 12 from stack, 6 from .env, API_URL overridden by --var');
  });

  it('uses the singular for one variable', () => {
    const line = variablesSetLine(
      { variables: [{ key: 'A', value: '1' }], added: [{ label: '--var', count: 1 }], overrides: [] },
      false,
    );

    expect(line).toBe('✔ 1 variable set — 1 from --var');
  });

  it('lists several overridden keys of one source together and several overriding sources in order', () => {
    const line = variablesSetLine(
      {
        variables: new Array(3).fill({ key: 'K', value: 'v' }),
        added: [{ label: 'stack', count: 3 }],
        overrides: [
          { label: '.env', keys: ['A', 'B'] },
          { label: '--var', keys: ['C'] },
        ],
      },
      false,
    );

    expect(line).toBe('✔ 3 variables set — 3 from stack, A, B overridden by .env, C overridden by --var');
  });

  it('colours the line green only on a terminal', () => {
    const merged = { variables: [{ key: 'A', value: '1' }], added: [{ label: '--var', count: 1 }], overrides: [] };

    expect(variablesSetLine(merged, true)).not.toBe(variablesSetLine(merged, false));
    expect(variablesSetLine(merged, true)).toContain('1 variable set');
  });

  it('never contains a value', () => {
    const line = variablesSetLine(
      {
        variables: [{ key: 'API_KEY', value: 'never-printed-value' }],
        added: [{ label: '--var', count: 1 }],
        overrides: [{ label: '--var', keys: ['API_KEY'] }],
      },
      false,
    );

    expect(line).not.toContain('never-printed-value');
  });

  it('names the state it is given and leaves out the dash when no source added anything', () => {
    const merged = { variables: [], added: [], overrides: [] };

    expect(variablesSetLine(merged, false, 'ready to set')).toBe('✔ 0 variables ready to set');
  });
});
