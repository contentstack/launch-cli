import { UsageError } from '../core/errors';

export interface Assignment {
  key: string;
  value: string | undefined;
}

function separatorIndex(token: string): number {
  const equals = token.indexOf('=');

  return equals === -1 ? token.indexOf(':') : equals;
}

export function parseAssignment(token: string): Assignment {
  const at = separatorIndex(token);
  const key = (at === -1 ? token : token.slice(0, at)).trim();

  if (key === '') {
    throw new UsageError('A variable needs a key before its value.');
  }

  if (at === -1) {
    return { key, value: undefined };
  }

  const value = token.slice(at + 1);

  if (value.trim() === '') {
    throw new UsageError(`${key} has an empty value. The Launch API does not accept one.`);
  }

  return { key, value };
}

const QUOTES = ['"', "'"];

export function splitLine(line: string): string[] {
  const tokens: string[] = [];
  let current: string | undefined;
  let quote: string | undefined;

  for (let at = 0; at < line.length; at += 1) {
    const char = line[at];

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (QUOTES.includes(char)) {
      quote = char;
      current ??= '';
    } else if (/\s/.test(char)) {
      if (current !== undefined) {
        tokens.push(current);
        current = undefined;
      }
    } else {
      current = (current ?? '') + char;
    }
  }

  if (quote !== undefined) {
    throw new UsageError('The line has an opening quote with no closing quote.');
  }

  return current === undefined ? tokens : [...tokens, current];
}
