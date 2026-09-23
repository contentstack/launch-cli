import { Flags } from '@oclif/core';

export const DEFAULT_SERVE_PORT = '3000';

export const serveFlags = {
  port: Flags.string({
    char: 'p',
    default: DEFAULT_SERVE_PORT,
    description: 'Port number',
  }),
  'data-dir': Flags.string({
    char: 'd',
    description: 'Current working directory',
  }),
};

export function isValidPort(input: string): boolean {
  const port = Number(input);
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}
