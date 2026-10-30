import { randomUUID } from 'node:crypto';

import { EMPTY_LIST_MESSAGE, secretColumns } from './secret.presenter';

describe('secretColumns', () => {
  it('has exactly the KEY and UPDATED columns, in that order', () => {
    expect(secretColumns().map((column) => column.header)).toEqual(['KEY', 'UPDATED']);
  });

  it('reads each cell from the key and updatedAt of the row', () => {
    const [key, updated] = secretColumns();
    const row = { key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' };

    expect(key.value(row)).toBe('API_TOKEN');
    expect(updated.value(row)).toBe('2026-09-01T10:00:00.000Z');
  });

  it('never reads a value off the row, even one the row carries', () => {
    const leaked = randomUUID();
    const row = { key: 'API_TOKEN', updatedAt: '2026-09-01', value: leaked } as never;

    expect(secretColumns().map((column) => column.value(row))).toEqual(['API_TOKEN', '2026-09-01']);
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('shows a dash for a key that is %s', (_label, key) => {
    expect(secretColumns()[0].value({ key, updatedAt: '2026-09-01' })).toBe('-');
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('shows a dash for an updatedAt that is %s', (_label, updatedAt) => {
    expect(secretColumns()[1].value({ key: 'A', updatedAt })).toBe('-');
  });
});

describe('EMPTY_LIST_MESSAGE', () => {
  it('says the environment holds no secrets', () => {
    expect(EMPTY_LIST_MESSAGE).toBe('No secrets found in this environment.');
  });
});
