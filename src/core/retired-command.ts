import { Command } from '@oclif/core';

import { EXIT_USAGE } from './constants';
import { failureOutputOf, reportFailure } from './failure';

export const V1_COMMAND_MESSAGE = 'Launch CLI v2 has new commands. Run csdx launch --help to see them.';

export abstract class RetiredCommand extends Command {
  static hidden = true;

  async run(): Promise<void> {
    this.error(V1_COMMAND_MESSAGE, { exit: EXIT_USAGE });
  }

  protected async catch(err: Error): Promise<unknown> {
    return reportFailure(err, failureOutputOf((original) => super.catch(original)));
  }
}
