import { parse } from 'dotenv';

import type { EnvironmentVariableInput } from '../environments/types';

export interface ParsedDotenv {
  variables: EnvironmentVariableInput[];
  skipped: string[];
}

export function parseDotenv(text: string | Buffer): ParsedDotenv {
  const variables: EnvironmentVariableInput[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(parse(text))) {
    if (value.trim() === '') {
      skipped.push(key);
    } else {
      variables.push({ key, value });
    }
  }

  return { variables, skipped };
}
