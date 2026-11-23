import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';

import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

const CONFIG: Record<string, unknown> = {
  authorisationType: 'BASIC',
  authtoken: 'test-authtoken',
  email: 'cli-user@example.test',
  region: {
    name: 'integration',
    cma: 'https://cma.integration.test',
    cda: 'https://cda.integration.test',
    uiHost: 'https://app.integration.test',
    launchHubUrl: 'https://launch-api.integration.test',
  },
};

let config: Interfaces.Config;

describe('integration: one short line for a command typed wrong', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
  });

  beforeEach(() => {
    process.exitCode = 0;
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  it.each([
    [['launch:projects:list', '--foo'], 'Run csdx launch:projects:list --help to see its flags.'],
    [['launch:env:get', 'staging'], 'Run csdx launch:env:get --help to see its flags.'],
    [['launch:projects:list', '--org'], '--org needs a value.'],
  ])('answers %p with one line naming what to run, exiting 2', async (argv, message) => {
    const { stderr, error } = await runCommand(argv, config);

    expect(stderr).toBe(`error: ${message}\n`);
    expect(error?.oclif?.exit).toBe(2);
  });

  it.each([
    [['help', 'launch'], 'For help, run csdx launch --help.'],
    [['help', 'launch:projects:list'], 'For help, run csdx launch:projects:list --help.'],
    [['launch', '-h'], 'For help, run csdx launch --help.'],
    [['launch:projects:list', '-h'], 'For help, run csdx launch:projects:list --help.'],
    [['launch', 'help'], 'For help, run csdx launch --help.'],
    [['launch:projects', 'help'], 'For help, run csdx launch:projects --help.'],
    [['launch:foo'], 'Run csdx launch --help to see all commands.'],
    [['launch:projects:lst'], 'Run csdx launch --help to see all commands.'],
    [['launch:projects:lst', '-h'], 'Run csdx launch --help to see all commands.'],
    [['launch:projects:lst', 'help'], 'Run csdx launch --help to see all commands.'],
    [['help', 'launch:projcts:list'], 'Run csdx launch --help to see all commands.'],
  ])('answers %p with one line pointing at --help, exiting 2', async (argv, message) => {
    const { stderr, stdout, error } = await runCommand(argv, config);

    expect(stderr).toBe(`error: ${message}\n`);
    expect(stdout).toBe('');
    expect(error?.oclif?.exit).toBe(2);
  });

  it.each([[['launch', '--help']], [['launch:projects', '--help']], [['launch:projects:list', '--help']]])(
    'still shows help for %p',
    async (argv) => {
      const { stdout, error } = await runCommand(argv, config);

      expect(stdout).toContain('USAGE');
      expect(error).toBeUndefined();
    },
  );

  it('leaves a group name typed alone showing its help', async () => {
    const { stdout, error } = await runCommand(['launch:env'], config);

    expect(stdout).toContain('launch:env:list');
    expect(error).toBeUndefined();
  });
});
