import { Flags } from '@oclif/core';

import { coreFlags } from '../core/catalog';

export const DEFAULT_SERVE_PORT = '3000';

export const serveFlags = {
  port: Flags.string({
    char: 'p',
    default: DEFAULT_SERVE_PORT,
    description: 'Port number',
  }),
  'data-dir': coreFlags['data-dir'],
};

export function isValidPort(input: string): boolean {
  if (typeof input !== 'string' || input.trim() === '') {
    return false;
  }

  const port = Number(input);
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}
