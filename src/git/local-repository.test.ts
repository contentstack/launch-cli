import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectGitHubRepository } from './local-repository';

let dir: string;

function gitDirectory(config: string, head = 'ref: refs/heads/main\n'): void {
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'config'), config);
  writeFileSync(join(dir, '.git', 'HEAD'), head);
}

describe('detectGitHubRepository', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-local-git-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the origin remote of a clone and names the GitHub owner and repository', () => {
    gitDirectory(
      '[remote "origin"]\n\turl = https://github.com/SakshiKoli-CS/next-partial-prerendering.git\n',
    );

    expect(detectGitHubRepository(dir)).toEqual({
      namespace: 'SakshiKoli-CS',
      repoName: 'SakshiKoli-CS/next-partial-prerendering',
    });
  });

  it('prefers the remote the checked-out branch tracks over origin', () => {
    gitDirectory(
      '[remote "upstream"]\n\turl = https://github.com/vercel-labs/next-partial-prerendering.git\n' +
        '[branch "main"]\n\tremote = upstream\n\tmerge = refs/heads/main\n' +
        '[remote "origin"]\n\turl = https://github.com/SakshiKoli-CS/next-partial-prerendering.git\n',
    );

    expect(detectGitHubRepository(dir)).toEqual({
      namespace: 'vercel-labs',
      repoName: 'vercel-labs/next-partial-prerendering',
    });
  });

  it.each<[string, string]>([
    ['ssh', 'git@github.com:SakshiKoli-CS/next-partial-prerendering.git'],
    ['ssh url', 'ssh://git@github.com/SakshiKoli-CS/next-partial-prerendering.git'],
    ['http', 'http://github.com/SakshiKoli-CS/next-partial-prerendering'],
    ['trailing slash', 'https://github.com/SakshiKoli-CS/next-partial-prerendering/'],
    ['https with a username', 'https://SakshiKoli-CS@github.com/SakshiKoli-CS/next-partial-prerendering.git'],
    [
      'https with a username and a credential',
      `https://SakshiKoli-CS:${randomUUID()}@github.com/SakshiKoli-CS/next-partial-prerendering.git`,
    ],
  ])('reads a %s remote url', (_form, url) => {
    gitDirectory(`[remote "origin"]\n\turl = ${url}\n`);

    expect(detectGitHubRepository(dir)).toEqual({
      namespace: 'SakshiKoli-CS',
      repoName: 'SakshiKoli-CS/next-partial-prerendering',
    });
  });

  it('falls back to origin when HEAD is detached', () => {
    gitDirectory(
      '[remote "origin"]\n\turl = https://github.com/SakshiKoli-CS/next-partial-prerendering.git\n',
      `${'9fceb02d'.repeat(5)}\n`,
    );

    expect(detectGitHubRepository(dir)).toEqual({
      namespace: 'SakshiKoli-CS',
      repoName: 'SakshiKoli-CS/next-partial-prerendering',
    });
  });

  it('falls back to origin when HEAD cannot be read', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(
      join(dir, '.git', 'config'),
      '[branch "main"]\n\tremote = upstream\n' +
        '[remote "origin"]\n\turl = https://github.com/SakshiKoli-CS/next-partial-prerendering.git\n',
    );

    expect(detectGitHubRepository(dir)).toEqual({
      namespace: 'SakshiKoli-CS',
      repoName: 'SakshiKoli-CS/next-partial-prerendering',
    });
  });

  it('falls back to origin when the checked-out branch tracks no remote', () => {
    gitDirectory(
      '[branch "main"]\n\tmerge = refs/heads/main\n' +
        '[remote "origin"]\n\turl = https://github.com/SakshiKoli-CS/next-partial-prerendering.git\n',
    );

    expect(detectGitHubRepository(dir)).toEqual({
      namespace: 'SakshiKoli-CS',
      repoName: 'SakshiKoli-CS/next-partial-prerendering',
    });
  });

  it.each<[string, string | undefined]>([
    ['the folder is not a working copy', undefined],
    ['the config names no remote', '[core]\n\tbare = false\n'],
    ['the tracked remote has no url', '[branch "main"]\n\tremote = origin\n[remote "origin"]\n\tfetch = +refs/*\n'],
    ['the remote is not GitHub', '[remote "origin"]\n\turl = https://gitlab.com/SakshiKoli-CS/site.git\n'],
    ['the remote names no repository', '[remote "origin"]\n\turl = https://github.com/SakshiKoli-CS\n'],
    ['the remote points below a repository', '[remote "origin"]\n\turl = https://github.com/a/b/c.git\n'],
    ['github.com is only the username of another host', '[remote "origin"]\n\turl = https://github.com@example.invalid/a/b.git\n'],
    ['the host merely starts with github.com', '[remote "origin"]\n\turl = https://user@github.com.example.invalid/a/b.git\n'],
    [
      'a second username hides another host',
      `[remote "origin"]\n\turl = https://user@github.com:${randomUUID()}@example.invalid/b.git\n`,
    ],
    [
      'an scp-style path hides another host',
      `[remote "origin"]\n\turl = git@github.com:${randomUUID()}@example.invalid/b.git\n`,
    ],
  ])('finds nothing when %s', (_reason, config) => {
    if (config !== undefined) {
      gitDirectory(config);
    }

    expect(detectGitHubRepository(dir)).toBeUndefined();
  });
});
