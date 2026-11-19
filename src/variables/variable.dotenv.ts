import type { EnvironmentVariableInput } from '../environments/types';

export interface ParsedDotenv {
  variables: EnvironmentVariableInput[];
  skipped: string[];
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
}

function readQuoted(text: string): ReadValue {
  const quote = text[0];
  const closing = findClosingQuote(text, quote);
  const inner = text.slice(1, closing);
  const value = quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : inner;

  return { value, linesRead: inner.split('\n').length };
}

function readValue(raw: string, following: string[]): ReadValue {
  const leading = raw.trimStart();

  if (QUOTES.includes(leading[0])) {
    return readQuoted([leading, ...following].join('\n'));
  }

  const comment = INLINE_COMMENT.exec(raw);

  return { value: (comment ? raw.slice(0, comment.index) : raw).trim(), linesRead: 1 };
}

function parse(text: string): Map<string, string> {
  const parsed = new Map<string, string>();
  const lines = text.split(/\r\n?|\n/);
  let index = 0;

  while (index < lines.length) {
    const statement = lines[index].trimStart().replace(EXPORT_PREFIX, '');
    const separator = statement.indexOf('=');

    if (statement.trim() === '' || statement.startsWith('#') || separator < 0) {
      index++;
      continue;
    }

    const { value, linesRead } = readValue(statement.slice(separator + 1), lines.slice(index + 1));

    parsed.set(statement.slice(0, separator).trim(), value);
    index += linesRead;
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
