import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalGitHubRepository {
  namespace: string;
  repoName: string;
}

interface ConfigEntry {
  kind: string;
  subsection: string;
  key: string;
  value: string;
}

const SECTION = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"]*)")?\s*\]/;
const ENTRY = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/;
const HEAD_BRANCH = /^ref:\s*refs\/heads\/(.+)$/;
const GITHUB_URL = /^(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const DEFAULT_REMOTE = 'origin';

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function entriesOf(config: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  let kind = '';
  let subsection = '';

  for (const line of config.split('\n')) {
    const section = SECTION.exec(line);

    if (section !== null) {
      kind = section[1].toLowerCase();
      subsection = section[2] ?? '';
      continue;
    }

    const entry = ENTRY.exec(line);

    if (entry !== null) {
      entries.push({ kind, subsection, key: entry[1].toLowerCase(), value: entry[2] });
    }
  }

  return entries;
}

function valueOf(entries: ConfigEntry[], kind: string, subsection: string, key: string): string | undefined {
  return entries.find(
    (entry) => entry.kind === kind && entry.subsection === subsection && entry.key === key,
  )?.value;
}

function checkedOutBranch(directory: string): string | undefined {
  const head = readText(join(directory, '.git', 'HEAD'));
  const match = head === undefined ? null : HEAD_BRANCH.exec(head.trim());

  return match === null ? undefined : match[1];
}

function trackedRemote(entries: ConfigEntry[], directory: string): string {
  const branch = checkedOutBranch(directory);
  const remote = branch === undefined ? undefined : valueOf(entries, 'branch', branch, 'remote');

  return remote ?? DEFAULT_REMOTE;
}

export function detectGitHubRepository(directory: string): LocalGitHubRepository | undefined {
  const config = readText(join(directory, '.git', 'config'));

  if (config === undefined) {
    return undefined;
  }

  const entries = entriesOf(config);
  const url = valueOf(entries, 'remote', trackedRemote(entries, directory), 'url');
  const match = url === undefined ? null : GITHUB_URL.exec(url);

  if (match === null) {
    return undefined;
  }

  const [, namespace, repository] = match;

  return { namespace, repoName: `${namespace}/${repository}` };
}
