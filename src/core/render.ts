export interface Pagination {
  count?: number;
  limit?: number;
  skip?: number | null;
}

export interface UxLike {
  print(message: string): void;
  inquire<T>(payload: unknown): Promise<T>;
}

export interface TableColumn<T> {
  header: string;
  value: (row: T) => string;
}

const GUTTER = '  ';
const UNPRINTABLE = '-';

function cellText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : UNPRINTABLE;
  }

  if (typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  return UNPRINTABLE;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function renderTable<T>(ux: UxLike, columns: TableColumn<T>[], rows: T[]): void {
  if (rows.length === 0) {
    ux.print('No records found.');
    return;
  }

  const cells = rows.map((row) => columns.map((column) => cellText(column.value(row))));
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
  const present = fields
    .map(([label, value]) => [label, cellText(value)] as [string, string])
    .filter(([, value]) => value !== '');
  const width = Math.max(0, ...present.map(([label]) => label.length));

  for (const [label, value] of present) {
    ux.print(`${label.padEnd(width)}${GUTTER}${value}`);
  }
}

export function renderPagination(ux: UxLike, pagination: Pagination | undefined, rowsPrinted: number): void {
  if (pagination === undefined) {
    return;
  }

  const printed = finite(rowsPrinted);
  const count = finite(pagination.count);

  if (printed === undefined || printed <= 0 || count === undefined || count <= 0) {
    return;
  }

  const skip = Math.max(0, Math.trunc(finite(pagination.skip) ?? 0));
  const first = skip + 1;
  const last = Math.min(skip + Math.trunc(printed), count);

  if (last < first) {
    ux.print(`Showing 0 of ${count}`);
    return;
  }

  ux.print(`Showing ${first}-${last} of ${count}`);
}
