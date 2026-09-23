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

  it('composes with renderTable to produce a single line for an empty result', () => {
    const { ux, lines } = fakeUx();

    renderTable(ux, [{ header: 'UID', value: (row: { uid: string }) => row.uid }], []);
    renderPagination(ux, { count: 0, limit: 50, skip: 0 });

    expect(lines).toEqual(['No records found.']);
  });
});
