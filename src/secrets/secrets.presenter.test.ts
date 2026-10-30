import { secretColumns } from './secrets.presenter';

describe('secrets presenter', () => {
  it('has exactly a KEY and an UPDATED column and no column that could carry a value', () => {
    const headers = secretColumns().map((column) => column.header);

    expect(headers).toEqual(['KEY', 'UPDATED']);
  });

  it('renders the key and the update time of a secret', () => {
    const [key, updated] = secretColumns();
    const secret = { key: 'API_TOKEN', updatedAt: '2026-09-01T10:00:00.000Z' };

    expect(key.value(secret)).toBe('API_TOKEN');
    expect(updated.value(secret)).toBe('2026-09-01T10:00:00.000Z');
  });

  it.each([[{}], [{ key: '', updatedAt: '' }], [{ key: '   ', updatedAt: '  ' }]])(
    'falls back to a dash for an absent key and update time (%p)',
    (secret) => {
      const [key, updated] = secretColumns();

      expect(key.value(secret)).toBe('-');
      expect(updated.value(secret)).toBe('-');
    },
  );
});
