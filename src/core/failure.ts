import { Errors, settings } from '@oclif/core';

import { EXIT_RUNTIME } from './constants';
import { styled } from './style';
import { asSentence } from './values';

export interface FailureOutput {
  print: (line: string) => void;
  colour: boolean;
  debug: boolean;
  fallback: (err: Error) => Promise<unknown>;
  command?: string;
}

/** Prints `error: <message>` once, as V1 did, then throws an error oclif exits on without printing it again. */
export function failWith(
  message: string,
  exit: number | undefined,
  output: Pick<FailureOutput, 'print' | 'colour'>,
): never {
  output.print(styled(`error: ${message}`, 'red', output.colour));

  const failure = new Errors.CLIError(message, { exit });
  Object.assign(failure, { skipOclifErrorHandling: true });
  throw failure;
}

export function writeToStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function failureOutputOf(fallback: (err: Error) => Promise<unknown>, command?: string): FailureOutput {
  return {
    print: writeToStderr,
    colour: Boolean(process.stdout.isTTY),
    debug: Boolean(settings.debug),
    fallback,
    command,
  };
}

const OCLIF_HELP_HINT = '\nSee more help with --help';

const HELP_SENTENCE = 'Run the command with --help to see its flags.';

function withHelpSentence(message: string): string {
  if (!message.endsWith(OCLIF_HELP_HINT)) {
    return message;
  }

  return `${asSentence(message.slice(0, -OCLIF_HELP_HINT.length))}\n${HELP_SENTENCE}`;
}

const MISSING_VALUE = /^Flag (--[\w-]+) expects a value$/;

const WRONG_INPUT = /^(Nonexistent flags?|Unexpected arguments?): /;

function parseRefusalMessage(message: string, command: string | undefined): string {
  const missingValue = MISSING_VALUE.exec(message);

  if (missingValue) {
    return `${missingValue[1]} needs a value.`;
  }

  if (command === undefined || !message.endsWith(OCLIF_HELP_HINT) || !WRONG_INPUT.test(message)) {
    return withHelpSentence(message);
  }

  if (message === `Unexpected argument: help${OCLIF_HELP_HINT}`) {
    return `For help, run csdx ${command} --help.`;
  }

  return `Run csdx ${command} --help to see its flags.`;
}

function alreadyReported(err: Error): boolean {
  return (err as Error & { skipOclifErrorHandling?: boolean }).skipOclifErrorHandling === true;
}

// csdx 2 makes plugins use its own @oclif/core through cli-utilities, so errors its Command throws are not
// instances of the Errors class imported here. Recognise them by the shape every oclif error carries.
export function isOclifError(err: unknown): err is Errors.CLIError {
  return err instanceof Error && typeof (err as { oclif?: unknown }).oclif === 'object';
}

function isExitRequest(err: Error): boolean {
  return isOclifError(err) && (err as { code?: unknown }).code === 'EEXIT';
}

export async function reportFailure(err: Error, output: FailureOutput): Promise<unknown> {
  if (isExitRequest(err) || alreadyReported(err)) {
    throw err;
  }

  if (isOclifError(err)) {
    return failWith(parseRefusalMessage(err.message, output.command), err.oclif.exit, output);
  }

  if (output.debug) {
    return output.fallback(err);
  }

  return failWith(err.message, EXIT_RUNTIME, output);
}

/**
 * The standalone bin's last handler, in place of oclif's: a failure raised before any command runs (an unknown
 * command, say) gets the same `error:` line. Under csdx this never runs, so the parent CLI keeps its own handling.
 */
export async function handleStandaloneFailure(err: Error): Promise<void> {
  try {
    await reportFailure(err, failureOutputOf(async (original) => Promise.reject(original)));
  } catch (reported) {
    await Errors.handle(reported as Error);
  }
}
