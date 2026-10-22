import { REDACTED } from '../core/redact';
import { pairColumns, variableColumns } from './variable.presenter';

function cells(variable: { key?: string; value?: string }, updatedAt?: string): string[] {
  return variableColumns(updatedAt).map((column) => column.value(variable));
}

describe('variable presenter', () => {
  it('offers the key and masked value columns on their own', () => {
    expect(pairColumns().map((column) => column.header)).toEqual(['KEY', 'VALUE']);
  });

  it('renders the key, a masked value and the environment update time', () => {
    const row = cells({ key: 'API_KEY', value: 'never-printed-abc' }, '2026-09-01T10:00:00.000Z');

    expect(variableColumns().map((column) => column.header)).toEqual(['KEY', 'VALUE', 'UPDATED']);
    expect(row).toEqual(['API_KEY', REDACTED, '2026-09-01T10:00:00.000Z']);
    expect(row.join(' ')).not.toContain('never-printed-abc');
  });

  it.each([[undefined], [''], ['   ']])('renders a placeholder for a key that is %p', (key) => {
    const row = cells({ key, value: 'secret' }, '2026-09-01');

    expect(row).toEqual(['-', REDACTED, '2026-09-01']);
  });

  it.each([[undefined], [''], ['   ']])('renders a placeholder for an update time that is %p', (updatedAt) => {
    const row = cells({ key: 'API_KEY' }, updatedAt);

    expect(row).toEqual(['API_KEY', REDACTED, '-']);
  });
});
