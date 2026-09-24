import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config, Errors, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';

const INVALID_PORT_RECORD =
  '{"level":"error","message":"Invalid port number. Please provide a valid port number between 0 and 65535."}\n';
const originalPort = process.env.PORT;

let config: Interfaces.Config;
let projectDir: string;

async function errorLog(): Promise<string> {
  const path = join(projectDir, 'logs', 'error.log');
  const deadline = Date.now() + 4000;
  while ((!existsSync(path) || readFileSync(path, 'utf8') === '') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('integration: launch:functions:serve port handling', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
  });

  beforeEach(() => {
    process.exitCode = 0;
    projectDir = mkdtempSync(join(tmpdir(), 'launch-serve-port-'));
    delete process.env.PORT;
  });

  afterEach(async () => {
    const logs = join(projectDir, 'logs');
    const deadline = Date.now() + 4000;
    while ((!existsSync(logs) || readdirSync(logs).length < 2) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    rmSync(projectDir, { recursive: true, force: true });
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }

    process.exitCode = 0;
  });

  it('logs the invalid port once, prints nothing to stderr and exits 1 without a second error message', async () => {
    const { error, stderr } = await runCommand(
      ['launch:functions:serve', '--port', '70000', '--data-dir', projectDir],
      config,
    );

    expect(error).toBeInstanceOf(Errors.ExitError);
    expect(error?.oclif?.exit).toBe(1);
    expect(stderr).toBe('');
    await expect(errorLog()).resolves.toBe(INVALID_PORT_RECORD);
  });

  it('lets an invalid PORT beat a valid --port, so the flag never reaches the server', async () => {
    process.env.PORT = '70000';

    const { error, stderr } = await runCommand(
      ['launch:functions:serve', '--port', '4000', '--data-dir', projectDir],
      config,
    );

    expect(error).toBeInstanceOf(Errors.ExitError);
    expect(error?.oclif?.exit).toBe(1);
    expect(stderr).toBe('');
    await expect(errorLog()).resolves.toBe(INVALID_PORT_RECORD);
  });

  it('rejects an empty --port through the same invalid port path', async () => {
    const { error, stderr } = await runCommand(
      ['launch:functions:serve', '--port', '""', '--data-dir', projectDir],
      config,
    );

    expect(error).toBeInstanceOf(Errors.ExitError);
    expect(error?.oclif?.exit).toBe(1);
    expect(stderr).toBe('');
    await expect(errorLog()).resolves.toBe(INVALID_PORT_RECORD);
  });
});
