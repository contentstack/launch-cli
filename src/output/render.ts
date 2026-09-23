import { Pagination } from '../api/types';

export interface UxLike {
  print(message: string): void;
  inquire<T>(payload: unknown): Promise<T>;
}

export interface TableColumn<T> {
  header: string;
  value: (row: T) => string;
}

const GUTTER = '  ';

export function renderTable<T>(ux: UxLike, columns: TableColumn<T>[], rows: T[]): void {
  if (rows.length === 0) {
    ux.print('No records found.');
    return;
  }

  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((rowCells) => rowCells[index].length)),
  );

  const line = (values: string[]) =>
    values
      .map((value, index) => (index === values.length - 1 ? value : value.padEnd(widths[index])))
      .join(GUTTER);

  ux.print(line(columns.map((column) => column.header)));
  for (const rowCells of cells) {
    ux.print(line(rowCells));
  }
}

export function renderDetail(ux: UxLike, fields: [string, string][]): void {
  const present = fields.filter(([, value]) => value !== '');
  const width = Math.max(0, ...present.map(([label]) => label.length));

  for (const [label, value] of present) {
    ux.print(`${label.padEnd(width)}${GUTTER}${value}`);
  }
}

export function renderPagination(ux: UxLike, pagination: Pagination): void {
  if (pagination.count === 0) {
    return;
  }

  const skip = pagination.skip ?? 0;
  const first = skip + 1;
  const last = Math.min(skip + pagination.limit, pagination.count);

  if (last < first) {
    ux.print(`Showing 0 of ${pagination.count}`);
    return;
  }

  ux.print(`Showing ${first}-${last} of ${pagination.count}`);
}
