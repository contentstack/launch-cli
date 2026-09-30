import { styled } from './style';

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

const BOX = {
  horizontal: '\u2500',
  dotted: '\u2504',
  vertical: '\u2502',
  topLeft: '\u250c',
  topJoin: '\u252c',
  topRight: '\u2510',
  midLeft: '\u251c',
  midJoin: '\u253c',
  midRight: '\u2524',
  bottomLeft: '\u2514',
  bottomJoin: '\u2534',
  bottomRight: '\u2518',
} as const;

const ELLIPSIS = '\u2026';
const CELL_PAD = '  ';
const CELL_PADDING = CELL_PAD.length * 2;
const EDGE_PADDING = 2 + CELL_PADDING;
const JOIN_PADDING = 1 + CELL_PADDING;
const NARROWEST_CELL = 1;
const FIRST_COLUMN = 0;

function unitsOf(text: string): string[] {
  return [...text];
}

function widthOf(text: string): number {
  return unitsOf(text).length;
}

function ruleOf(widths: number[], left: string, join: string, right: string, fill: string): string {
  return left + widths.map((width) => fill.repeat(width + CELL_PADDING)).join(join) + right;
}

function fitCell(text: string, width: number): string {
  const units = unitsOf(text);

  if (units.length > width) {
    return `${units.slice(0, width - 1).join('')}${ELLIPSIS}`;
  }

  return text + ' '.repeat(width - units.length);
}

function joinCells(fitted: string[]): string {
  return `${BOX.vertical}${CELL_PAD}${fitted.join(`${CELL_PAD}${BOX.vertical}${CELL_PAD}`)}${CELL_PAD}${BOX.vertical}`;
}

function rowOf(cells: string[], widths: number[]): string {
  return joinCells(cells.map((cell, index) => fitCell(cell, widths[index])));
}

function headerRowOf(headers: string[], widths: number[], outputIsTTY: boolean): string {
  return joinCells(headers.map((header, index) => styled(fitCell(header, widths[index]), 'bold', outputIsTTY)));
}

function fittedWidths(
  widths: number[],
  floors: number[],
  flexible: number,
  available: number | undefined,
): number[] {
  if (available === undefined) {
    return widths;
  }

  const chrome = EDGE_PADDING + (widths.length - 1) * JOIN_PADDING;
  const drawn = widths.reduce((sum, width) => sum + width, 0) + chrome;

  if (drawn <= available) {
    return widths;
  }

  const fitted = [...widths];
  fitted[flexible] = Math.max(NARROWEST_CELL, floors[flexible], widths[flexible] - (drawn - available));

  return fitted;
}

export function renderTable<T>(
  ux: UxLike,
  columns: TableColumn<T>[],
  rows: T[],
  available?: number,
  flexible: number = FIRST_COLUMN,
  outputIsTTY = false,
): void {
  if (rows.length === 0) {
    ux.print('No records found.');
    return;
  }

  if (columns.length === 0) {
    return;
  }

  const headers = columns.map((column) => column.header);
  const cells = rows.map((row) => columns.map((column) => cellText(column.value(row))));
  const natural = columns.map((column, index) =>
    Math.max(widthOf(column.header), ...cells.map((rowCells) => widthOf(rowCells[index]))),
  );
  const widths = fittedWidths(natural, headers.map(widthOf), flexible, available);

  ux.print(ruleOf(widths, BOX.topLeft, BOX.topJoin, BOX.topRight, BOX.horizontal));
  ux.print(headerRowOf(headers, widths, outputIsTTY));
  ux.print(ruleOf(widths, BOX.midLeft, BOX.midJoin, BOX.midRight, BOX.horizontal));

  cells.forEach((rowCells, index) => {
    if (index > 0) {
      ux.print(ruleOf(widths, BOX.midLeft, BOX.midJoin, BOX.midRight, BOX.dotted));
    }

    ux.print(rowOf(rowCells, widths));
  });

  ux.print(ruleOf(widths, BOX.bottomLeft, BOX.bottomJoin, BOX.bottomRight, BOX.horizontal));
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
