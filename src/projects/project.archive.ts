import AdmZip from 'adm-zip';
import { Stats, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { UsageError } from '../core/errors';

export const UPLOAD_EXCLUDED_NAMES: readonly string[] = [
  'node_modules',
  '.git',
  '.env',
  '.env.local',
  '.next',
  'logs',
  '.vscode',
  '.cs-launch.json',
];

export interface ArchivedDirectory {
  buffer: Buffer;
  entries: string[];
  skippedLinks: string[];
}

export const ROOT_ONLY_EXCLUDED_NAMES: readonly string[] = ['logs'];

export function isExcludedName(name: string, atRoot: boolean): boolean {
  if (ROOT_ONLY_EXCLUDED_NAMES.includes(name) || name.endsWith('.zip')) {
    return atRoot;
  }

  return UPLOAD_EXCLUDED_NAMES.includes(name);
}

interface Collected {
  files: Map<string, Stats>;
  links: string[];
}

function directoryStats(root: string) {
  try {
    return lstatSync(root);
  } catch {
    return undefined;
  }
}

function unreadable(relative: string): UsageError {
  return new UsageError(
    `The file "${relative}" could not be read, so the upload was not attempted. ` +
      'Fix its permissions, or pass --data-dir with a folder the CLI can read.',
  );
}

function readable<T>(relative: string, read: () => T): T {
  try {
    return read();
  } catch {
    throw unreadable(relative);
  }
}

function collect(root: string, prefix: string, found: Collected, skipped: readonly string[]): void {
  const listing = readable(prefix === '' ? '.' : prefix, () => readdirSync(join(root, prefix)));

  for (const entry of listing) {
    if (isExcludedName(entry, prefix === '')) {
      continue;
    }

    const relative = prefix === '' ? entry : `${prefix}/${entry}`;

    if (skipped.includes(resolve(root, relative))) {
      continue;
    }

    const stats = readable(relative, () => lstatSync(join(root, relative)));

    if (stats.isDirectory()) {
      collect(root, relative, found, skipped);
      continue;
    }

    if (stats.isSymbolicLink()) {
      found.links.push(relative);
      continue;
    }

    if (stats.isFile()) {
      found.files.set(relative, stats);
    }
  }
}

export function archiveDirectory(root: string, excludedFiles: readonly string[] = []): ArchivedDirectory {
  const stats = directoryStats(root);

  if (stats === undefined || !stats.isDirectory()) {
    throw new UsageError(
      `No local project directory at "${root}". Pass --data-dir with the folder you want to upload.`,
    );
  }

  const found: Collected = { files: new Map(), links: [] };
  collect(
    root,
    '',
    found,
    excludedFiles.map((path) => resolve(path)),
  );
  const entries = [...found.files.keys()].sort();

  if (entries.length === 0) {
    throw new UsageError(
      `Nothing to upload from "${root}" once ${UPLOAD_EXCLUDED_NAMES.join(', ')} are excluded. ` +
        'Pass --data-dir with the folder you want to upload.',
    );
  }

  const zip = new AdmZip();

  for (const entry of entries) {
    zip.addFile(entry, readable(entry, () => readFileSync(join(root, entry))), '', found.files.get(entry));
  }

  return { buffer: zip.toBuffer(), entries, skippedLinks: found.links.sort() };
}
