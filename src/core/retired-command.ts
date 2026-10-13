import { Command } from '@oclif/core';

import { EXIT_USAGE } from './constants';

export function retirementMessage(name: string, replacements: readonly string[]): string {
  const named = replacements.map((replacement) => `csdx ${replacement}`);
  const last = named[named.length - 1];
  const listed = named.length === 1 ? last : `${named.slice(0, -1).join(', ')} or ${last}`;

  return `csdx ${name} was removed in Launch CLI v2. Use ${listed} instead.`;
}

export abstract class RetiredCommand extends Command {
  static retiredName = '';

  static replacements: readonly string[] = [];

  async run(): Promise<void> {
    const contract = this.constructor as typeof RetiredCommand;

    this.error(retirementMessage(contract.retiredName, contract.replacements), { exit: EXIT_USAGE });
  }
}
