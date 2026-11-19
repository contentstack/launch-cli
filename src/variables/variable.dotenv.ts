import type { EnvironmentVariableInput } from '../environments/types';

export interface ParsedDotenv {
  variables: EnvironmentVariableInput[];
  skipped: string[];
}

export class DotenvLineError extends Error {
  constructor(
    readonly line: number,
    readonly problem: string,
  ) {
    super(`Line ${line} ${problem}`);
    this.name = 'DotenvLineError';
  }
}

const INLINE_COMMENT = /[ \t]#/;
const EXPORT_PREFIX = /^export[ \t]+/;
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const QUOTES = ['"', "'", '`'];

function findClosingQuote(text: string, quote: string): number {
  for (let position = 1; position < text.length; position++) {
    if (text[position] === '\\') {
      position++;
    } else if (text[position] === quote) {
      return position;
    }
  }

  return -1;
}

interface ReadValue {
  value: string;
  linesRead: number;
  tail: string;
}

function endsLine(tail: string): boolean {
  return tail === '' || tail.startsWith('#');
}

function unquote(inner: string, quote: string): string {
  return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : inner;
}

function readQuoted(text: string): ReadValue | undefined {
  const quote = text[0];
  const closing = findClosingQuote(text, quote);

  if (closing < 0) {
    return undefined;
  }

  const inner = text.slice(1, closing);

  return {
    value: unquote(inner, quote),
    linesRead: inner.split('\n').length,
    tail: text.slice(closing + 1).split('\n')[0].trim(),
  };
}

function readQuotedToLineEnd(line: string): ReadValue | undefined {
  const quote = line[0];

  for (let closing = line.lastIndexOf(quote); closing > 0; closing = line.lastIndexOf(quote, closing - 1)) {
    if (endsLine(line.slice(closing + 1).trim())) {
      return { value: unquote(line.slice(1, closing), quote), linesRead: 1, tail: '' };
    }
  }

  return undefined;
}

function readValue(raw: string, following: string[]): ReadValue | undefined {
  const leading = raw.trimStart();

  if (QUOTES.includes(leading[0])) {
    const read = readQuoted([leading, ...following].join('\n'));

    return read !== undefined && endsLine(read.tail) ? read : (readQuotedToLineEnd(leading) ?? read);
  }

  const comment = INLINE_COMMENT.exec(raw);

  return { value: (comment ? raw.slice(0, comment.index) : raw).trim(), linesRead: 1, tail: '' };
}

function parse(text: string): Map<string, string> {
  const parsed = new Map<string, string>();
  const lines = text.split(/\r\n?|\n/);
  let index = 0;

  while (index < lines.length) {
    const statement = lines[index].trimStart().replace(EXPORT_PREFIX, '');
    const separator = statement.indexOf('=');

    if (statement.trim() === '' || statement.startsWith('#')) {
      index++;
      continue;
    }

    if (separator < 0) {
      throw new DotenvLineError(index + 1, 'has no "="');
    }

    const key = statement.slice(0, separator).trim();

    if (key === '') {
      throw new DotenvLineError(index + 1, 'has no key before "="');
    }

    if (!VALID_KEY.test(key)) {
      throw new DotenvLineError(index + 1, 'has an invalid key before "="');
    }

    if (parsed.has(key)) {
      throw new DotenvLineError(index + 1, `repeats the key ${key}`);
    }

    const read = readValue(statement.slice(separator + 1), lines.slice(index + 1));
    const closesBadly = read !== undefined && !endsLine(read.tail);

    if (read === undefined) {
      throw new DotenvLineError(index + 1, `opens a quote for ${key} that is never closed`);
    }

    if (closesBadly && read.linesRead > 1) {
      throw new DotenvLineError(
        index + 1,
        `opens a quote for ${key} that closes on line ${index + read.linesRead} with text after it`,
      );
    }

    if (closesBadly) {
      throw new DotenvLineError(index + 1, `has text after the closing quote of ${key}`);
    }

    parsed.set(key, read.value);
    index += read.linesRead;
  }

  return parsed;
}

export function parseDotenv(text: string | Buffer): ParsedDotenv {
  const variables: EnvironmentVariableInput[] = [];
  const skipped: string[] = [];

  for (const [key, value] of parse(text.toString())) {
    if (value.trim() === '') {
      skipped.push(key);
    } else {
      variables.push({ key, value });
    }
  }

  return { variables, skipped };
}
