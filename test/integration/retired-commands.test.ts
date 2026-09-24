import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { productionSources } from '../support/sources';

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

const PLANNED_COMMANDS: Record<string, string> = {
  'launch:environments:create': 'CL-7168',
  'launch:environments:list': 'CL-7168',
  'launch:deployments:create': 'CL-7170',
  'launch:deployments:get': 'CL-7170',
  'launch:deployments:list': 'CL-7170',
  'launch:deployments:rollback': 'CL-7170',
  'launch:logs:get': 'CL-7171',
  'launch:site:open': 'CL-7172',
};

function commandsNamedInSource(): string[] {
  const named = productionSources().flatMap((source) => [...source.text.matchAll(/\blaunch(?::[a-z][a-z-]*)+/g)].map((match) => match[0]));

  return [...new Set(named)].sort();
}

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
    const projectDir = mkdtempSync(join(tmpdir(), 'launch-retired-serve-'));

    const { error } = await runCommand(['launch:functions:serve', '--port', '70000', '--data-dir', projectDir], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('EEXIT: 1');
    expect(error?.message).not.toContain('was removed in Launch CLI v2');
    const logs = join(projectDir, 'logs');
    const deadline = Date.now() + 5000;
    while ((!existsSync(logs) || readdirSync(logs).length < 2) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(readdirSync(logs).sort()).toEqual(['error.log', 'info.log']);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('names only commands that exist or are planned in a ticket, wherever the CLI tells a user to run one', () => {
    const registered = new Set(config.commands.map((command) => command.id));
    const named = commandsNamedInSource();
    const unknown = named.filter((id) => !registered.has(id) && PLANNED_COMMANDS[id] === undefined);

    expect(named).toEqual(expect.arrayContaining(['launch:deployments:create', 'launch:logs:get', 'launch:site:open']));
    expect(unknown).toEqual([]);
  });

  it('drops a command from the planned list once it ships, so the list cannot hide a typo later', () => {
    const registered = new Set(config.commands.map((command) => command.id));

    expect(Object.entries(PLANNED_COMMANDS).filter(([id]) => registered.has(id))).toEqual([]);
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
