import { join } from 'node:path';

import { UsageError } from '../core/errors';
import { parseDotenv } from './variable.dotenv';
import type { ParsedDotenv } from './variable.dotenv';

export const STDIN_PATH = '-';

export const AUTO_DETECTED_FILES = ['.env.local', '.env'] as const;

export interface EnvFileReader {
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

export interface EnvFileSource extends ParsedDotenv {
  label: string;
}

async function readOne(path: string, reader: EnvFileReader): Promise<EnvFileSource> {
  if (path === STDIN_PATH) {
    return { label: 'standard input', ...parseDotenv(await reader.readStdin()) };
  }

  try {
    return { label: path, ...parseDotenv(await reader.readFile(path)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UsageError(`--dotenv ${path} was not found.`);
    }

    throw error;
  }
}

export async function readEnvFiles(paths: string[], reader: EnvFileReader): Promise<EnvFileSource[]> {
  if (paths.filter((path) => path === STDIN_PATH).length > 1) {
    throw new UsageError('--dotenv - can be given only once.');
  }

  const sources: EnvFileSource[] = [];

  for (const path of paths) {
    sources.push(await readOne(path, reader));
  }

  return sources;
}

export function detectEnvFile(dataDir: string, exists: (path: string) => boolean): string | undefined {
  return AUTO_DETECTED_FILES.map((name) => join(dataDir, name)).find((path) => exists(path));
}
