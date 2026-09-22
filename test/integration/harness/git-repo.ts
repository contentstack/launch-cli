import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';

export type GitRepoOptions = {
  remoteUrl: string;
  defaultBranch?: string;
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export class GitRepo {
  private bareDir?: string;

  readonly defaultBranch: string;

  constructor(
    private readonly projectDir: string,
    private readonly options: GitRepoOptions,
  ) {
    this.defaultBranch = options.defaultBranch ?? 'main';
  }

  init(): void {
    this.bareDir = mkdtempSync(join(tmpdir(), 'launch-cli-itest-remote-'));
    execFileSync('git', ['init', '--bare', '--quiet', this.bareDir], { stdio: 'ignore' });

    git(this.projectDir, 'init', '--quiet', '--initial-branch', this.defaultBranch);
    git(this.projectDir, 'config', 'user.email', 'integration@example.com');
    git(this.projectDir, 'config', 'user.name', 'Integration Test');
    git(this.projectDir, 'config', 'commit.gpgsign', 'false');
    git(this.projectDir, 'add', '--all');
    git(this.projectDir, 'commit', '--quiet', '--allow-empty', '--message', 'initial commit');

    git(this.projectDir, 'remote', 'add', 'origin', this.options.remoteUrl);
    const rewriteBase = this.bareDir.split(sep).join('/');
    git(this.projectDir, 'config', `url.${rewriteBase}.insteadOf`, this.options.remoteUrl);
    git(this.projectDir, 'push', '--quiet', 'origin', this.defaultBranch);
  }

  cleanup(): void {
    if (!this.bareDir) return;
    rmSync(this.bareDir, { recursive: true, force: true });
    this.bareDir = undefined;
  }
}
