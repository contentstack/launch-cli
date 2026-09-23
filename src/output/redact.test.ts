import { REDACTED, redactedColumn } from './redact';
import { renderTable } from './render';

interface Variable {
  key: string;
  value: string;
}

function fakeUx() {
  const printed: string[] = [];
  return { ux: { print: (message: string) => printed.push(message), inquire: async () => undefined as never }, printed };
}

describe('redactedColumn', () => {
  it('keeps the header and masks every row without reading it', () => {
    const column = redactedColumn<Variable>('Value');

    expect(column.header).toBe('Value');
    expect(column.value({ key: 'API_TOKEN', value: 'cs-super-secret' })).toBe(REDACTED);
  });

  it('masks the value in rendered table output so the secret never reaches the terminal', () => {
    const { ux, printed } = fakeUx();
    const rows: Variable[] = [
      { key: 'API_TOKEN', value: 'cs-super-secret' },
      { key: 'REGION', value: 'eu-west-1' },
    ];

    renderTable(ux, [{ header: 'Key', value: (row: Variable) => row.key }, redactedColumn<Variable>('Value')], rows);

    expect(printed).toEqual(['Key        Value', `API_TOKEN  ${REDACTED}`, `REGION     ${REDACTED}`]);
    expect(printed.join('\n')).not.toContain('cs-super-secret');
    expect(printed.join('\n')).not.toContain('eu-west-1');
  });
});
