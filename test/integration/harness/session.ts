import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { configHandler } from '@contentstack/cli-utilities';

import launchConfig from '../../../src/config';
import { GitRepo, GitRepoOptions } from './git-repo';
import { LaunchApiMock } from './launch-api';
import { cma } from './cma';
import { prompts } from './prompts';

const CMA_HOST = 'api.contentstack.io';

export type AuthMode = 'BASIC' | 'OAUTH' | 'NONE';

export type SessionOptions = {
  files?: Record<string, string>;
  launchConfigFile?: Record<string, any>;
  launchConfigFileAt?: string;
  gitRepo?: GitRepoOptions;
  auth?: AuthMode;
};

export class Session {
  readonly api = new LaunchApiMock();
  projectDir = '';
  gitRepo?: GitRepo;

  private originalPollingInterval = launchConfig.pollingInterval;
  private launchConfigRelativePath = launchConfig.configName;

  async start(options: SessionOptions = {}): Promise<void> {
    await this.api.start();

    this.projectDir = mkdtempSync(join(tmpdir(), 'launch-cli-itest-project-'));
    for (const [relativePath, contents] of Object.entries(options.files ?? {})) {
      const target = resolve(this.projectDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents, 'utf8');
    }
    if (options.gitRepo) {
      this.gitRepo = new GitRepo(this.projectDir, options.gitRepo);
      this.gitRepo.init();
    }
    this.launchConfigRelativePath = options.launchConfigFileAt ?? launchConfig.configName;
    if (options.launchConfigFile) {
      mkdirSync(dirname(this.launchConfigPath), { recursive: true });
      writeFileSync(this.launchConfigPath, JSON.stringify(options.launchConfigFile, null, 2), 'utf8');
    }

    configHandler.set('region', {
      name: 'integration-test',
      cma: CMA_HOST,
      cda: 'cdn.contentstack.io',
      uiHost: 'app.contentstack.com',
      launchHubUrl: this.api.baseUrl,
    });

    const auth = options.auth ?? 'BASIC';
    if (auth === 'NONE') {
      configHandler.delete('authorisationType');
      configHandler.delete('authtoken');
    } else {
      configHandler.set('authorisationType', auth);
      if (auth === 'OAUTH') {
        configHandler.set('oauthAccessToken', 'integration-test-oauth-token');
      } else {
        configHandler.set('authtoken', 'integration-test-authtoken');
      }
    }

    launchConfig.pollingInterval = 20;

    prompts.install();
  }

  async stop(): Promise<void> {
    try {
      prompts.restore();
      prompts.reset();
      cma.reset();
      this.api.reset();
      await this.api.stop();
    } finally {
      launchConfig.pollingInterval = this.originalPollingInterval;

      for (const key of ['region', 'authorisationType', 'authtoken', 'oauthAccessToken', 'oauthOrgUid']) {
        configHandler.delete(key);
      }

      this.gitRepo?.cleanup();
      this.gitRepo = undefined;
      this.launchConfigRelativePath = launchConfig.configName;

      if (this.projectDir) {
        rmSync(this.projectDir, { recursive: true, force: true });
        this.projectDir = '';
      }
    }
  }

  get launchConfigPath(): string {
    return resolve(this.projectDir, this.launchConfigRelativePath);
  }

  get baseArgs(): string[] {
    return ['--data-dir', this.projectDir];
  }

  hasLaunchConfigFile(): boolean {
    return existsSync(this.launchConfigPath);
  }

  readLaunchConfigFile(): Record<string, any> {
    if (!this.hasLaunchConfigFile()) {
      throw new Error(`The CLI did not write ${launchConfig.configName} to ${this.projectDir}`);
    }
    return JSON.parse(readFileSync(this.launchConfigPath, 'utf8'));
  }
}

export const startSession = async (options?: SessionOptions): Promise<Session> => {
  const session = new Session();
  await session.start(options);
  return session;
};
