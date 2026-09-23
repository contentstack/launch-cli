import { Pagination, UxLike, renderDetail, renderPagination, renderTable } from './render';

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
  it('pads every column to its widest cell including the header', () => {
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
      'UID        NAME',
      'p1         marketing-site',
      'project-2  docs',
    ]);
  });

  it('prints a placeholder when there are no rows', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], []);

    expect(lines).toEqual(['No records found.']);
  });

  it('pads a single column', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'UID', value: (row: { uid: string }) => row.uid }],
      [{ uid: 'p1' }],
    );

    expect(lines).toEqual(['UID', 'p1']);
  });

  it('handles columns wider than header', () => {
    const { ux, lines } = fakeUx();

    renderTable(
      ux,
      [{ header: 'ID', value: (row: { id: string }) => row.id }],
      [{ id: 'very-long-id-value' }],
    );

    expect(lines).toEqual(['ID', 'very-long-id-value']);
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

    expect(lines).toEqual(['UID  NAME', '     site']);
  });

  it.each([
    [123, '123'],
    [0, '0'],
    [true, 'true'],
    [false, 'false'],
    [BigInt(10), '10'],
  ])('renders the non-string cell %p as %j rather than crashing', (value, expected) => {
    const { ux, lines } = fakeUx();
    const width = Math.max('NAME'.length, expected.length);

    renderTable(
      ux,
      [
        { header: 'NAME', value: () => value as unknown as string },
        { header: 'TAIL', value: () => 'ok' },
      ],
      [{}, {}],
    );

    expect(lines).toEqual([
      `${'NAME'.padEnd(width)}  TAIL`,
      `${expected.padEnd(width)}  ok`,
      `${expected.padEnd(width)}  ok`,
    ]);
  });

  it.each([[{}], [[1, 2]], [Symbol('x')], [() => undefined], [Number.NaN], [Number.POSITIVE_INFINITY]].map((value) => [value]))(
    'renders the unprintable cell %p as a dash rather than object text',
    (value) => {
      const { ux, lines } = fakeUx();

      renderTable(ux, [{ header: 'NAME', value: () => value as unknown as string }], [{}]);

      expect(lines).toEqual(['NAME', '-']);
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

    expect(lines).toEqual(['NAME  TAIL', '      ok']);
  });

  it('pads a middle column to its widest cell and leaves the last column unpadded', () => {
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

    expect(lines).toEqual([
      'A   B                        C',
      'a1  a-very-wide-middle-cell  c1',
      'a2  b2                       c2',
    ]);
  });
});

describe('renderDetail', () => {
  it('aligns labels and skips empty values', () => {
    const { ux, lines } = fakeUx();

    renderDetail(ux, [
      ['uid', 'p1'],
      ['name', 'site'],
      ['description', ''],
    ]);

    expect(lines).toEqual(['uid   p1', 'name  site']);
  });

  it('prints nothing when all fields are empty', () => {
    const { ux, lines } = fakeUx();

    renderDetail(ux, [
      ['uid', ''],
      ['name', ''],
      ['description', ''],
    ]);

    expect(lines).toEqual([]);
  });

  it('skips a field whose value is absent rather than printing undefined', () => {
    const { ux, lines } = fakeUx();

    renderDetail(ux, [
      ['uid', undefined as unknown as string],
      ['name', 'site'],
    ]);

    expect(lines).toEqual(['name  site']);
  });

  it.each([
    [123, '123'],
    [true, 'true'],
  ])('renders the non-string detail value %p as %j', (value, expected) => {
    const { ux, lines } = fakeUx();

    renderDetail(ux, [['uid', value as unknown as string]]);

    expect(lines).toEqual([`uid  ${expected}`]);
  });

  it.each([[{}], [Number.NaN]])('renders the unprintable detail value %p as a dash', (value) => {
    const { ux, lines } = fakeUx();

    renderDetail(ux, [['uid', value as unknown as string]]);

    expect(lines).toEqual(['uid  -']);
  });

  it('aligns a single non-empty field', () => {
    const { ux, lines } = fakeUx();

    renderDetail(ux, [
      ['uid', 'p1'],
    ]);

    expect(lines).toEqual(['uid  p1']);
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
    [undefined as unknown as number],
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

    renderPagination(ux, undefined as unknown as Pagination, 3);

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
