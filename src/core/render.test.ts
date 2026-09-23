import { UxLike, renderDetail, renderPagination, renderTable } from './render';

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

    renderPagination(ux, { count: 120, limit: 50, skip: 50 });

    expect(lines).toEqual(['Showing 51-100 of 120']);
  });

  it('clamps the window to the total on the last page', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 3, limit: 50, skip: 0 });

    expect(lines).toEqual(['Showing 1-3 of 3']);
  });

  it('prints nothing when count is zero', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 0, limit: 50, skip: 0 });

    expect(lines).toEqual([]);
  });

  it('shows correct window at page boundary', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 100, limit: 25, skip: 75 });

    expect(lines).toEqual(['Showing 76-100 of 100']);
  });

  it('treats a null skip as the first page', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 11, limit: 2, skip: null });

    expect(lines).toEqual(['Showing 1-2 of 11']);
  });

  it('treats a missing skip as the first page', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 11, limit: 2 });

    expect(lines).toEqual(['Showing 1-2 of 11']);
  });

  it('reports an empty window rather than an impossible range when skip is past the end', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 200 });

    expect(lines).toEqual(['Showing 0 of 50']);
  });

  it('reports an empty window rather than an impossible range when the limit is zero', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 0, skip: 0 });

    expect(lines).toEqual(['Showing 0 of 50']);
  });

  it('reports an empty window when skip equals the total count', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 50 });

    expect(lines).toEqual(['Showing 0 of 50']);
  });

  it('reports a single-record window when skip is one short of the total count', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 50, limit: 50, skip: 49 });

    expect(lines).toEqual(['Showing 50-50 of 50']);
  });

  it('clamps a limit larger than the total count to the count', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 3, limit: 500, skip: 0 });

    expect(lines).toEqual(['Showing 1-3 of 3']);
  });

  it('prints nothing when count is zero even with a limit and a skip past the end', () => {
    const { ux, lines } = fakeUx();

    renderPagination(ux, { count: 0, limit: 50, skip: 200 });

    expect(lines).toEqual([]);
  });

  it('composes with renderTable to produce a single line for an empty result', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], []);
    renderPagination(ux, { count: 0, limit: 50, skip: 0 });

    expect(lines).toEqual(['No records found.']);
  });
});
