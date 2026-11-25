import { Flags } from '@oclif/core';

import { coreFlags } from '../core/catalog';

export const DEFAULT_SERVE_PORT = '3000';

export const serveFlags = {
  port: Flags.string({
    default: DEFAULT_SERVE_PORT,
    env: 'PORT',
    description: 'Port number',
  }),
  'data-dir': coreFlags['data-dir'],
};

export function isValidPort(input: string): boolean {
  if (typeof input !== 'string' || !/^\d+$/.test(input)) {
    return false;
  }

  const port = Number(input);
  return port <= 65535;
}
