import { Config, Plugin } from '@oclif/core';

export async function loadCliConfig(): Promise<Config> {
  const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
  await plugin.load();

  return Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
}

export function routeConsoleLogToStdout(): void {
  jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
    process.stdout.write(`${String(message)}\n`);
  });
}
