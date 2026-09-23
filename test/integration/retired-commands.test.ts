import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const DATA_DIR = tmpdir();

const CONFIG: Record<string, unknown> = {
  authorisationType: 'BASIC',
  authtoken: 'test-authtoken',
  email: 'cli-user@example.test',
  region: {
    name: 'integration',
    cma: 'https://cma.integration.test',
    cda: 'https://cda.integration.test',
    uiHost: 'https://app.integration.test',
    launchHubUrl: LAUNCH_HUB_URL,
  },
};

let config: Interfaces.Config;

describe('integration: retired V1 command names', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
  });

  beforeEach(() => {
    process.exitCode = 0;
    jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
      process.stdout.write(`${String(message)}\n`);
    });
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.cleanAll();
  });

  it('exits 2 naming the three V2 create commands for the bare launch name', async () => {
    const { error } = await runCommand(['launch'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      'csdx launch was removed in Launch CLI v2. Use csdx launch:projects:create, ' +
        'csdx launch:environments:create or csdx launch:deployments:create instead.',
    );
  });

  it.each([
    [
      'launch:deployments',
      'csdx launch:deployments was removed in Launch CLI v2. Use csdx launch:deployments:list instead.',
    ],
    [
      'launch:environments',
      'csdx launch:environments was removed in Launch CLI v2. Use csdx launch:environments:list instead.',
    ],
    ['launch:open', 'csdx launch:open was removed in Launch CLI v2. Use csdx launch:site:open instead.'],
    ['launch:logs', 'csdx launch:logs was removed in Launch CLI v2. Use csdx launch:logs:get instead.'],
    [
      'launch:rollback',
      'csdx launch:rollback was removed in Launch CLI v2. Use csdx launch:deployments:rollback instead.',
    ],
    ['launch:functions', 'csdx launch:functions was removed in Launch CLI v2. Use csdx launch:functions:serve instead.'],
  ])('exits 2 with the CLI its own migration message for %s', async (name, message) => {
    const { error } = await runCommand([name], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(message);
  });

  it.each([
    ['launch'],
    ['launch:deployments'],
    ['launch:environments'],
    ['launch:open'],
    ['launch:logs'],
    ['launch:rollback'],
    ['launch:functions'],
  ])('answers %s with its own message rather than oclif command-not-found', async (name) => {
    const { error } = await runCommand([name], config);

    expect(error?.message).toContain('was removed in Launch CLI v2');
    expect(error?.message).not.toContain('command not found');
    expect(error?.oclif?.exit).toBe(2);
  });

  it('keeps the retired names refusing even when V1 flags are passed alongside them', async () => {
    const { error } = await runCommand(['launch:logs', '--type', 'deployment', '--data-dir', DATA_DIR], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('csdx launch:logs:get');
  });

  it('leaves the live child of the retired functions topic reachable', async () => {
    const { error } = await runCommand(['launch:functions:serve', '--port', '70000'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('Invalid port number. Please provide a valid port number between 0 and 65535.');
    expect(error?.message).not.toContain('was removed in Launch CLI v2');
  });

  it('lists the V2 topics under launch --help', async () => {
    const { stdout } = await runCommand(['launch', '--help'], config);

    expect(stdout).toContain('launch:projects');
    expect(stdout).toContain('launch:functions');
  });

  it("lists the projects resource's verbs under launch:projects --help", async () => {
    const { stdout } = await runCommand(['launch:projects', '--help'], config);

    expect(stdout).toContain('launch:projects:list');
    expect(stdout).toContain('launch:projects:get');
  });
});
