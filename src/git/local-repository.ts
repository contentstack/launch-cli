import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface LocalGitHubRepository {
  namespace: string;
  repoName: string;
  root: string;
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
const GIT_FILE_POINTER = /^gitdir:\s*(.+?)\s*$/m;
const GITHUB_HOST = '(?:https?:\\/\\/(?:[^@/]+@)?github\\.com\\/|(?:ssh:\\/\\/)?[^@/]+@github\\.com[:/])';
const GITHUB_NAME = '[A-Za-z0-9._-]+';
const GITHUB_URL = new RegExp(`^${GITHUB_HOST}(${GITHUB_NAME})\\/(${GITHUB_NAME}?)(?:\\.git)?\\/?$`);
const DEFAULT_REMOTE = 'origin';
const LOCAL_REMOTE = '.';

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

function workingCopyAbove(start: string): string | undefined {
  let folder = resolve(start);

  while (!existsSync(join(folder, '.git'))) {
    const parent = dirname(folder);

    if (parent === folder) {
      return undefined;
    }

    folder = parent;
  }

  return folder;
}

interface GitDirectories {
  gitDirectory: string;
  commonDirectory: string;
}

// A worktree's or submodule's .git is a file naming its git directory;
// a worktree's commondir names the repository whose config it shares.
function gitDirectoriesOf(root: string): GitDirectories | undefined {
  const dotGit = join(root, '.git');
  const gitFile = readText(dotGit);

  if (gitFile === undefined) {
    return { gitDirectory: dotGit, commonDirectory: dotGit };
  }

  const pointer = GIT_FILE_POINTER.exec(gitFile);

  if (pointer === null) {
    return undefined;
  }

  const gitDirectory = resolve(root, pointer[1]);
  const commonPath = readText(join(gitDirectory, 'commondir'));

  return {
    gitDirectory,
    commonDirectory: commonPath === undefined ? gitDirectory : resolve(gitDirectory, commonPath.trim()),
  };
}

function checkedOutBranch(gitDirectory: string): string | undefined {
  const head = readText(join(gitDirectory, 'HEAD'));
  const match = head === undefined ? null : HEAD_BRANCH.exec(head.trim());

  return match === null ? undefined : match[1];
}

function trackedRemote(entries: ConfigEntry[], gitDirectory: string): string {
  const branch = checkedOutBranch(gitDirectory);
  const remote = branch === undefined ? undefined : valueOf(entries, 'branch', branch, 'remote');

  return remote === undefined || remote === LOCAL_REMOTE ? DEFAULT_REMOTE : remote;
}

export function detectGitHubRepository(directory: string): LocalGitHubRepository | undefined {
  const root = workingCopyAbove(directory);

  if (root === undefined) {
    return undefined;
  }

  const directories = gitDirectoriesOf(root);

  if (directories === undefined) {
    return undefined;
  }

  const config = readText(join(directories.commonDirectory, 'config'));

  if (config === undefined) {
    return undefined;
  }

  const entries = entriesOf(config);
  const url = valueOf(entries, 'remote', trackedRemote(entries, directories.gitDirectory), 'url');
  const match = url === undefined ? null : GITHUB_URL.exec(url);

  if (match === null) {
    return undefined;
  }

  const [, namespace, repository] = match;

  return { namespace, repoName: `${namespace}/${repository}`, root };
}
