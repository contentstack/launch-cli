import type { EnvironmentVariableInput } from '../environments/types';

export interface ParsedDotenv {
  variables: EnvironmentVariableInput[];
  skipped: string[];
}

const INLINE_COMMENT = /[ \t]#/;
const EXPORT_PREFIX = /^export[ \t]+/;
const QUOTES = ['"', "'"];

function readValue(raw: string): string {
  const leading = raw.trimStart();

  if (QUOTES.includes(leading[0])) {
    return leading.slice(1, leading.indexOf(leading[0], 1));
  }

  const comment = INLINE_COMMENT.exec(raw);

  return (comment ? raw.slice(0, comment.index) : raw).trim();
}

function parse(text: string): Map<string, string> {
  const parsed = new Map<string, string>();

  for (const line of text.split(/\r\n?|\n/)) {
    const trimmed = line.trim().replace(EXPORT_PREFIX, '');
    const separator = trimmed.indexOf('=');

    if (trimmed === '' || trimmed.startsWith('#') || separator < 0) {
      continue;
    }

    parsed.set(trimmed.slice(0, separator).trim(), readValue(trimmed.slice(separator + 1)));
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
