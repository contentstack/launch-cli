import AdmZip from 'adm-zip';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
}

export function isExcludedName(name: string): boolean {
  return UPLOAD_EXCLUDED_NAMES.includes(name);
}

function directoryStats(root: string) {
  try {
    return lstatSync(root);
  } catch {
    return undefined;
  }
}

function collect(root: string, prefix: string, found: string[]): void {
  for (const entry of readdirSync(join(root, prefix))) {
    if (isExcludedName(entry)) {
      continue;
    }

    const relative = prefix === '' ? entry : `${prefix}/${entry}`;
    const stats = lstatSync(join(root, relative));

    if (stats.isDirectory()) {
      collect(root, relative, found);
      continue;
    }

    if (stats.isFile()) {
      found.push(relative);
    }
  }
}

export function archiveDirectory(root: string): ArchivedDirectory {
  const stats = directoryStats(root);

  if (stats === undefined || !stats.isDirectory()) {
    throw new UsageError(
      `No local project directory at "${root}". Pass --data-dir with the folder you want to upload.`,
    );
  }

  const entries: string[] = [];
  collect(root, '', entries);

  if (entries.length === 0) {
    throw new UsageError(
      `Nothing to upload from "${root}" once ${UPLOAD_EXCLUDED_NAMES.join(', ')} are excluded. ` +
        'Pass --data-dir with the folder you want to upload.',
    );
  }

  entries.sort();

  const zip = new AdmZip();

  for (const entry of entries) {
    zip.addFile(entry, readFileSync(join(root, entry)));
  }

  return { buffer: zip.toBuffer(), entries };
}
