import { styled } from './style';
import { withoutControlCharacters } from './values';
import type { UxLike } from './prompt';

export interface Pagination {
  count?: number;
  limit?: number;
  skip?: number | null;
}

export interface TableColumn<T> {
  header: string;
  value: (row: T) => string;
  minWidth?: number;
  label?: boolean;
}

export const UID_WIDTH = 24;

const UNPRINTABLE = '-';

function cellText(value: unknown): string {
  if (typeof value === 'string') {
    return withoutControlCharacters(value);
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

const CELL_PAD = '  ';
const CELL_PADDING = CELL_PAD.length * 2;
const EDGE_PADDING = 2 + CELL_PADDING;
const JOIN_PADDING = 1 + CELL_PADDING;
const READABLE_CELL = 10;
const STACKED_GAP = '  ';
const OWN_LINE_INDENT = '  ';

function unitsOf(text: string): string[] {
  return [...text];
}

function widthOf(text: string): number {
  return unitsOf(text).length;
}

function ruleOf(widths: number[], left: string, join: string, right: string, fill: string): string {
  return left + widths.map((width) => fill.repeat(width + CELL_PADDING)).join(join) + right;
}

function padCell(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - widthOf(text)));
}

function breakAt(units: string[], width: number): number {
  const space = units.lastIndexOf(' ', width);

  return space > 0 ? space + 1 : width;
}

export function wrapCell(text: string, width: number): string[] {
  const lines: string[] = [];
  let units = unitsOf(text);

  while (units.length > width) {
    const cut = breakAt(units.slice(0, width + 1), width);
    lines.push(units.slice(0, cut).join('').trimEnd());
    units = units.slice(cut);

    while (units[0] === ' ') {
      units.shift();
    }
  }

  if (units.length > 0 || lines.length === 0) {
    lines.push(units.join(''));
  }

  return lines;
}

function joinCells(fitted: string[]): string {
  return `${BOX.vertical}${CELL_PAD}${fitted.join(`${CELL_PAD}${BOX.vertical}${CELL_PAD}`)}${CELL_PAD}${BOX.vertical}`;
}

function rowLinesOf(cells: string[], widths: number[]): string[] {
  const wrapped = cells.map((cell, index) => wrapCell(cell, widths[index]));
  const height = Math.max(...wrapped.map((lines) => lines.length));

  return Array.from({ length: height }, (_, line) =>
    joinCells(wrapped.map((lines, index) => padCell(lines[line] ?? '', widths[index]))),
  );
}

function headerRowOf(headers: string[], widths: number[], outputIsTTY: boolean): string {
  return joinCells(headers.map((header, index) => styled(padCell(header, widths[index]), 'bold', outputIsTTY)));
}

function drawnWidth(widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + EDGE_PADDING + (widths.length - 1) * JOIN_PADDING;
}

function widestShrinkable(widths: number[], floors: number[]): number {
  let widest = -1;

  widths.forEach((width, index) => {
    if (width > floors[index] && (widest === -1 || width > widths[widest])) {
      widest = index;
    }
  });

  return widest;
}

function fittedWidths(natural: number[], floors: number[], available: number): number[] | undefined {
  const widths = [...natural];

  while (drawnWidth(widths) > available) {
    const widest = widestShrinkable(widths, floors);

    if (widest === -1) {
      return undefined;
    }

    widths[widest] -= 1;
  }

  return widths;
}

function floorOf<T>(column: TableColumn<T>, natural: number): number {
  if (column.label === true) {
    return natural;
  }

  return Math.min(natural, Math.max(widthOf(column.header), column.minWidth ?? READABLE_CELL));
}

function printLabelled(
  ux: UxLike,
  pairs: [string, string][],
  available: number,
  boldLabels: boolean,
): void {
  const labelWidth = Math.max(...pairs.map(([label]) => widthOf(label)));
  const indent = ' '.repeat(labelWidth + STACKED_GAP.length);
  const besideLabel = available - indent.length >= UID_WIDTH;

  pairs.forEach(([label, value]) => {
    const shownLabel = styled(besideLabel ? padCell(label, labelWidth) : label, 'bold', boldLabels);

    if (besideLabel) {
      const [first, ...rest] = wrapCell(value, available - indent.length);

      ux.print(`${shownLabel}${STACKED_GAP}${first}`);
      rest.forEach((line) => ux.print(`${indent}${line}`));
      return;
    }

    ux.print(shownLabel);
    wrapCell(value, Math.max(available - OWN_LINE_INDENT.length, UID_WIDTH)).forEach((line) =>
      ux.print(`${OWN_LINE_INDENT}${line}`),
    );
  });
}

function renderStacked(
  ux: UxLike,
  headers: string[],
  cells: string[][],
  available: number,
  outputIsTTY: boolean,
): void {
  cells.forEach((rowCells, index) => {
    if (index > 0) {
      ux.print('');
    }

    printLabelled(
      ux,
      rowCells.map((cell, column): [string, string] => [headers[column], cell]),
      available,
      outputIsTTY,
    );
  });
}

function renderDetailLines(ux: UxLike, cells: string[][], available: number): void {
  printLabelled(
    ux,
    cells.map(([label, value]): [string, string] => [label, value]),
    available,
    false,
  );
}

function drawBox(ux: UxLike, headers: string[], cells: string[][], widths: number[], outputIsTTY: boolean): void {
  ux.print(ruleOf(widths, BOX.topLeft, BOX.topJoin, BOX.topRight, BOX.horizontal));
  ux.print(headerRowOf(headers, widths, outputIsTTY));
  ux.print(ruleOf(widths, BOX.midLeft, BOX.midJoin, BOX.midRight, BOX.horizontal));

  cells.forEach((rowCells, index) => {
    if (index > 0) {
      ux.print(ruleOf(widths, BOX.midLeft, BOX.midJoin, BOX.midRight, BOX.dotted));
    }

    rowLinesOf(rowCells, widths).forEach((line) => ux.print(line));
  });

  ux.print(ruleOf(widths, BOX.bottomLeft, BOX.bottomJoin, BOX.bottomRight, BOX.horizontal));
}

export function renderTable<T>(
  ux: UxLike,
  columns: TableColumn<T>[],
  rows: T[],
  available?: number,
  outputIsTTY = false,
): void {
  if (rows.length === 0) {
    ux.print(styled('No records found.', 'yellow', outputIsTTY));
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

  if (available === undefined) {
    drawBox(ux, headers, cells, natural, outputIsTTY);
    return;
  }

  const widths = fittedWidths(
    natural,
    columns.map((column, index) => floorOf(column, natural[index])),
    available,
  );

  if (widths === undefined && columns.length === 2 && columns[0].label === true) {
    renderDetailLines(ux, cells, available);
    return;
  }

  if (widths === undefined) {
    renderStacked(ux, headers, cells, available, outputIsTTY);
    return;
  }

  drawBox(ux, headers, cells, widths, outputIsTTY);
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
