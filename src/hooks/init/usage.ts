import type { Hook } from '@oclif/core';

import { EXIT_USAGE } from '../../core/constants';
import { failWith, failureOutputOf } from '../../core/failure';

const LAUNCH_ID = /^launch(:|$)/;

export const UNKNOWN_COMMAND_MESSAGE = 'Run csdx launch --help to see all commands.';

function forHelp(id: string): string {
  return `For help, run csdx ${id} --help.`;
}

function beforeEndOfFlags(argv: string[]): string[] {
  const end = argv.indexOf('--');

  return end === -1 ? argv : argv.slice(0, end);
}

/** The one-line answer to a launch command typed in a form V2 does not take, or undefined when it is fine. */
export function usageProblem(
  id: string | undefined,
  argv: string[],
  known: (id: string) => boolean,
): string | undefined {
  const asksHelpFor = id === 'help' ? argv[0] : undefined;
  const target = id === 'help' ? asksHelpFor : id;

  if (target === undefined || !LAUNCH_ID.test(target)) {
    return undefined;
  }

  if (!known(target)) {
    return UNKNOWN_COMMAND_MESSAGE;
  }

  if (asksHelpFor !== undefined || argv[0] === 'help' || beforeEndOfFlags(argv).includes('-h')) {
    return forHelp(target);
  }

  return undefined;
}

const usage: Hook.Init = async function ({ id, argv, config }) {
  const problem = usageProblem(
    id,
    argv,
    (candidate) => config.findCommand(candidate) !== undefined || config.findTopic(candidate) !== undefined,
  );

  if (problem !== undefined) {
    failWith(problem, EXIT_USAGE, failureOutputOf(async (original) => Promise.reject(original)));
  }
};

export default usage;
