import { randomBytes } from 'node:crypto';

import { renderPagination, renderTable } from './render';
import type { UxLike } from './prompt';

const FIRST_UID = randomBytes(12).toString('hex');
const SECOND_UID = randomBytes(12).toString('hex');

function fakeUx() {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  return { ux, lines };
}

describe('renderTable', () => {
  it('draws a box around cells padded to the widest value in each column, header included', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'UID', value: (row: { uid: string; name: string }) => row.uid },
        { header: 'NAME', value: (row: { uid: string; name: string }) => row.name },
      ],
      [
        { uid: 'p1', name: 'marketing-site' },
        { uid: 'project-2', name: 'docs' },
      ],
    );

    expect(lines).toEqual([
      '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502  UID        \u2502  NAME            \u2502',
      '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
      '\u2502  p1         \u2502  marketing-site  \u2502',
      '\u251c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u253c\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2524',
      '\u2502  project-2  \u2502  docs            \u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
    ]);
  });

  it('prints a placeholder and draws no box when there are no rows', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], []);

    expect(lines).toEqual(['No records found.']);
  });

  it('prints the no-rows placeholder in yellow when the output is a terminal', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], [], undefined, true);

    expect(lines).toEqual(['\u001b[33mNo records found.\u001b[39m']);
  });

  it('boxes a single column', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], [{ uid: 'p1' }]);

    expect(lines).toEqual([
      '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502  UID  \u2502',
      '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
      '\u2502  p1   \u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
    ]);
  });

  it('widens a column past its header when the value is longer', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'ID', value: (row: { id: string }) => row.id }], [{ id: 'very-long-id-value' }]);

    expect(lines[1]).toBe('\u2502  ID                  \u2502');
    expect(lines[3]).toBe('\u2502  very-long-id-value  \u2502');
  });

  it('renders a blank cell rather than crashing when a column yields no value', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'UID', value: (row: { uid?: string }) => row.uid as string },
        { header: 'NAME', value: () => 'site' },
      ],
      [{}],
    );

    expect(lines[3]).toBe('\u2502       \u2502  site  \u2502');
  });

  it.each([
    [123, '\u2502  123   \u2502  ok    \u2502'],
    [0, '\u2502  0     \u2502  ok    \u2502'],
    [true, '\u2502  true  \u2502  ok    \u2502'],
    [false, '\u2502  false  \u2502  ok    \u2502'],
    [BigInt(10), '\u2502  10    \u2502  ok    \u2502'],
  ])('renders the non-string cell %p as %j rather than crashing', (value, line) => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'NAME', value: () => value as unknown as string },
        { header: 'TAIL', value: () => 'ok' },
      ],
      [{}, {}],
    );

    expect(lines[3]).toBe(line);
    expect(lines[5]).toBe(line);
  });

  it.each([[{}], [[1, 2]], [Symbol('x')], [() => undefined], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'renders the unprintable cell %p as a dash rather than object text',
    (value) => {
      const { ux, lines } = fakeUx();

      renderTable(ux, [{ header: 'NAME', value: () => value as unknown as string }], [{}]);

      expect(lines[3]).toBe('\u2502  -     \u2502');
    },
  );

  it.each([[undefined], [null]])('renders the absent cell %p as a blank', (value) => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'NAME', value: () => value as unknown as string },
        { header: 'TAIL', value: () => 'ok' },
      ],
      [{}],
    );

    expect(lines[3]).toBe('\u2502        \u2502  ok    \u2502');
  });

  it('pads every column to its widest cell, the last one included', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'A', value: (row: { a: string; b: string; c: string }) => row.a },
        { header: 'B', value: (row: { a: string; b: string; c: string }) => row.b },
        { header: 'C', value: (row: { a: string; b: string; c: string }) => row.c },
      ],
      [
        { a: 'a1', b: 'a-very-wide-middle-cell', c: 'c1' },
        { a: 'a2', b: 'b2', c: 'c2' },
      ],
    );

    expect(lines[1]).toBe('\u2502  A   \u2502  B                        \u2502  C   \u2502');
    expect(lines[3]).toBe('\u2502  a1  \u2502  a-very-wide-middle-cell  \u2502  c1  \u2502');
    expect(lines[5]).toBe('\u2502  a2  \u2502  b2                       \u2502  c2  \u2502');
  });

  it('shrinks the widest column first and wraps its text onto extra lines rather than cutting it', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'NAME', value: (row: { name: string; url: string }) => row.name },
        { header: 'URL', value: (row: { name: string; url: string }) => row.url },
      ],
      [{ name: 'staging', url: 'https://staging-site.contentstackapps.com' }],
      44,
    );

    expect(lines.slice(3, 5)).toEqual([
      '\u2502  staging  \u2502  https://staging-site.conte  \u2502',
      '\u2502           \u2502  ntstackapps.com             \u2502',
    ]);
    expect(lines.map((line) => [...line].length)).toEqual([44, 44, 44, 44, 44, 44]);
    expect(lines.join('')).not.toContain('\u2026');
  });

  it('breaks a wrapped cell at the last space that fits, and only hard-breaks a word longer than the cell', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'NOTE', value: (row: { note: string }) => row.note }],
      [{ note: 'one two three abcdefghijklmnop' }],
      16,
    );

    expect(lines.slice(3, -1)).toEqual([
      '\u2502  one two     \u2502',
      '\u2502  three       \u2502',
      '\u2502  abcdefghij  \u2502',
      '\u2502  klmnop      \u2502',
    ]);
  });

  it('shares the shrinking out, so the long URL gives way before the short name is touched', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'NAME', value: (row: { name: string; url: string }) => row.name },
        { header: 'URL', value: (row: { name: string; url: string }) => row.url },
      ],
      [{ name: 'production-eu', url: 'https://production-eu.contentstackapps.com' }],
      50,
    );

    expect(lines[3]).toContain('\u2502  production-eu  \u2502');
  });

  it('never narrows a column below its minWidth, so a UID stays whole on one line', () => {
    const { ux, lines } = fakeUx();
    const uid = FIRST_UID;

    renderTable(
      ux,
      [
        { header: 'UID', value: (row: { uid: string; note: string }) => row.uid, minWidth: 24 },
        { header: 'NOTE', value: (row: { uid: string; note: string }) => row.note },
      ],
      [{ uid, note: 'a note long enough to need wrapping' }],
      50,
    );

    expect(lines[3]).toContain(`\u2502  ${uid}  \u2502`);
    expect(lines.slice(4, -1).every((line) => line.startsWith(`\u2502  ${' '.repeat(24)}  \u2502`))).toBe(true);
    expect(lines.map((line) => [...line].length).every((width) => width === 50)).toBe(true);
  });

  it('prints each record as a stacked list of labelled lines when the columns cannot fit even at their floors', () => {
    const { ux, lines } = fakeUx();
    const columns = [
      { header: 'DEPLOYMENT UID', value: (row: { uid: string; status: string }) => row.uid, minWidth: 24 },
      { header: 'STATUS', value: (row: { uid: string; status: string }) => row.status },
    ];

    renderTable(
      ux,
      columns,
      [
        { uid: FIRST_UID, status: 'LIVE' },
        { uid: SECOND_UID, status: 'FAILED' },
      ],
      30,
    );

    expect(lines).toEqual([
      `DEPLOYMENT UID  ${FIRST_UID}`,
      'STATUS          LIVE',
      '',
      `DEPLOYMENT UID  ${SECOND_UID}`,
      'STATUS          FAILED',
    ]);
  });

  it('wraps a long stacked value under itself, indented past the labels, so no line outgrows the terminal', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'UID', value: (row: { uid: string; url: string }) => row.uid, minWidth: 24 },
        { header: 'URL', value: (row: { uid: string; url: string }) => row.url, minWidth: 24 },
      ],
      [{ uid: FIRST_UID, url: 'https://staging-site.contentstackapps.com' }],
      30,
    );

    expect(lines).toEqual([`UID  ${FIRST_UID}`, 'URL  https://staging-site.cont', '     entstackapps.com']);
  });

  it('bolds the stacked labels on a terminal and leaves the values plain', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'UID', value: (row: { uid: string }) => row.uid, minWidth: 24 }],
      [{ uid: FIRST_UID }],
      20,
      true,
    );

    expect(lines).toEqual([`\u001b[1mUID\u001b[22m  ${FIRST_UID}`]);
  });

  it('stops shrinking a plain column at ten characters and stacks rather than squeezing it further', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'NAME', value: (row: { name: string }) => row.name }],
      [{ name: 'abcdefghijklmnop' }],
      15,
    );

    expect(lines).toEqual(['NAME  abcdefghijklmnop']);
  });

  it('keeps a column at its header width when that is wider than ten characters', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'ENVIRONMENT NAME', value: (row: { name: string }) => row.name }],
      [{ name: 'a-very-long-environment-name' }],
      22,
    );

    expect(lines[1]).toBe('\u2502  ENVIRONMENT NAME  \u2502');
    expect(lines.slice(3, -1)).toEqual(['\u2502  a-very-long-envi  \u2502', '\u2502  ronment-name      \u2502']);
  });

  it.each([
    [33, 'exactly fills the terminal'],
    [40, 'leaves room to spare'],
  ])('leaves every column at its natural width when the box already fits (%i columns, %s)', (available) => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [
        { header: 'NAME', value: (row: { name: string; uid: string }) => row.name },
        { header: 'UID', value: (row: { name: string; uid: string }) => row.uid },
      ],
      [{ name: 'a-long-project-name', uid: 'p1' }],
      available,
    );

    expect(lines[3]).toBe('\u2502  a-long-project-name  \u2502  p1   \u2502');
  });

  it('leaves the table alone when no terminal width is known, so piped output keeps every value whole', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'NAME', value: (row: { name: string }) => row.name }],
      [{ name: 'a-long-project-name' }],
      undefined,
    );

    expect(lines[3]).toBe('\u2502  a-long-project-name  \u2502');
  });

  it('measures and wraps by character, so an astral cell never splits into a replacement glyph', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'NAME', value: (row: { name: string }) => row.name }],
      [{ name: '\u{1f600}'.repeat(12) }],
      16,
    );

    expect(lines.slice(3, -1)).toEqual([
      `\u2502  ${'\u{1f600}'.repeat(10)}  \u2502`,
      `\u2502  ${'\u{1f600}'.repeat(2)}          \u2502`,
    ]);
    expect(lines.map((line) => [...line].length).every((width) => width === 16)).toBe(true);
    expect(lines.join('')).not.toContain('\ufffd');
  });

  it('bolds the header cells on a terminal, after padding them, and leaves the data rows alone', () => {
    const { ux, lines } = fakeUx();
    const columns = [{ header: 'NAME', value: (row: { name: string }) => row.name }];

    renderTable(ux, columns, [{ name: 'a-long-name' }], undefined, true);

    expect(lines[1]).toBe('\u2502  \u001b[1mNAME       \u001b[22m  \u2502');
    expect(lines[3]).toBe('\u2502  a-long-name  \u2502');
    expect(lines[0]).toBe('\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
  });

  it('leaves the header plain when the output is not a terminal', () => {
    const { ux, lines } = fakeUx();
    const columns = [{ header: 'NAME', value: (row: { name: string }) => row.name }];

    renderTable(ux, columns, [{ name: 'site' }]);

    expect(lines[1]).toBe('\u2502  NAME  \u2502');
    expect(lines.join('\n')).not.toContain('\u001b');
  });

  it.each([
    ['a line feed', 'Ship it\n\nCo-Authored-By: Claude'],
    ['a carriage return', 'Ship it\r\nbody'],
    ['a tab', 'Ship\tit'],
    ['a colour escape', 'Ship \u001b[31mit\u001b[39m'],
    ['a bell and a C1 control', 'Ship\u0007 it\u0085'],
  ])('keeps a cell holding %s on one line, so the box keeps its shape', (_label, value) => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'MESSAGE', value: (row: { value: string }) => row.value }], [{ value }, { value: 'ok' }]);

    expect(lines).toHaveLength(7);
    lines.forEach((line) => expect(line).not.toMatch(/\p{Cc}/u));
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
    expect(lines[3].startsWith('\u2502  Ship')).toBe(true);
  });

  it('prints nothing rather than an unclosable box when there are no columns to size', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [], [{}], 10);

    expect(lines).toEqual([]);
  });
});

describe('renderPagination', () => {
  it('reports the window and the total', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 120, limit: 50, skip: 50 }, 50);

    expect(lines).toEqual(['Showing 51-100 of 120']);
  });

  it('clamps the window to the total on the last page', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 3, limit: 50, skip: 0 }, 3);

    expect(lines).toEqual(['Showing 1-3 of 3']);
  });

  it('prints nothing when count is zero', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 0, limit: 50, skip: 0 }, 0);

    expect(lines).toEqual([]);
  });

  it('shows correct window at page boundary', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 100, limit: 25, skip: 75 }, 25);

    expect(lines).toEqual(['Showing 76-100 of 100']);
  });

  it('treats a null skip as the first page', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 11, limit: 2, skip: null }, 2);

    expect(lines).toEqual(['Showing 1-2 of 11']);
  });

  it('treats a missing skip as the first page', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 11, limit: 2 }, 2);

    expect(lines).toEqual(['Showing 1-2 of 11']);
  });

  it('reports an empty window rather than an impossible range when skip is past the end', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 200 }, 50);

    expect(lines).toEqual(['Showing 0 of 50']);
  });

  it('reports an empty window when skip equals the total count', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 50 }, 50);

    expect(lines).toEqual(['Showing 0 of 50']);
  });

  it('reports a single-record window when skip is one short of the total count', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 49 }, 1);

    expect(lines).toEqual(['Showing 50-50 of 50']);
  });

  it('describes the rows actually printed rather than the window that was requested', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 0 }, 3);

    expect(lines).toEqual(['Showing 1-3 of 50']);
  });

  it.each([[0], [-1], [Number.NaN], [undefined as unknown as number]])(
    'prints nothing when the row count is %p because no row was rendered',
    (rows) => {
      const { ux, lines } = fakeUx();

      renderPagination(ux, { count: 50, limit: 50, skip: 0 }, rows);

      expect(lines).toEqual([]);
    },
  );

  it.each([
    [undefined as unknown as number],
    [null as unknown as number],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    ['7' as unknown as number],
  ])('prints nothing rather than a total of %p when count is not a finite number', (count) => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count, limit: 50, skip: 0 }, 3);

    expect(lines).toEqual([]);
  });

  it.each([
    [undefined],
    [null as unknown as number],
    [Number.NaN],
    ['50' as unknown as number],
  ])('reports the rows printed even when the limit is %p', (limit) => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 7, limit, skip: 0 }, 2);

    expect(lines).toEqual(['Showing 1-2 of 7']);
  });

  it.each([[-9], [-1], ['3' as unknown as number], [Number.NaN], [1.5]])(
    'clamps the unusable skip %p to the first page rather than printing a negative range',
    (skip) => {
      const { ux, lines } = fakeUx();

      renderPagination(ux, { count: 50, limit: 50, skip }, 40);

      expect(lines).toEqual([skip === 1.5 ? 'Showing 2-41 of 50' : 'Showing 1-40 of 50']);
    },
  );

  it('prints nothing rather than reading fields off an absent pagination block', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, undefined, 3);

    expect(lines).toEqual([]);
  });

  it('prints nothing when count is zero even with a limit and a skip past the end', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 0, limit: 50, skip: 200 }, 0);

    expect(lines).toEqual([]);
  });

  it('composes with renderTable to produce a single line for an empty result', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], []);
    renderPagination(ux, { count: 0, limit: 50, skip: 0 }, 0);

    expect(lines).toEqual(['No records found.']);
  });
});
