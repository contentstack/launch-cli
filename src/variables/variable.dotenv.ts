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

function readQuoted(text: string): ReadValue | undefined {
  const quote = text[0];
  const closing = findClosingQuote(text, quote);

  if (closing < 0) {
    return undefined;
  }

  const inner = text.slice(1, closing);
  const value = quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : inner;

  return { value, linesRead: inner.split('\n').length, tail: text.slice(closing + 1).split('\n')[0].trim() };
}

function readValue(raw: string, following: string[]): ReadValue | undefined {
  const leading = raw.trimStart();

  if (QUOTES.includes(leading[0])) {
    return readQuoted([leading, ...following].join('\n'));
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

    const read = readValue(statement.slice(separator + 1), lines.slice(index + 1));

    if (read === undefined) {
      throw new DotenvLineError(index + 1, `opens a quote for ${key} that is never closed`);
    }

    if (read.tail !== '' && !read.tail.startsWith('#')) {
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
