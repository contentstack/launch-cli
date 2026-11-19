import type { EnvironmentVariableInput } from '../environments/types';

export interface ParsedDotenv {
  variables: EnvironmentVariableInput[];
  skipped: string[];
}

const INLINE_COMMENT = /[ \t]#/;
const QUOTED = /^(["'])(.*)\1$/;

function readValue(raw: string): string {
  const value = raw.trim();
  const quoted = QUOTED.exec(value);

  if (quoted) {
    return quoted[2];
  }

  const comment = INLINE_COMMENT.exec(value);

  return (comment ? value.slice(0, comment.index) : value).trim();
}

function parse(text: string): Map<string, string> {
  const parsed = new Map<string, string>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
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
