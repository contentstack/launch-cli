import { Errors, settings } from '@oclif/core';

import { EXIT_RUNTIME } from './constants';
import { styled } from './style';

export interface FailureOutput {
  print: (line: string) => void;
  colour: boolean;
  debug: boolean;
  fallback: (err: Error) => Promise<unknown>;
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

export function failureOutputOf(fallback: (err: Error) => Promise<unknown>): FailureOutput {
  return {
    print: writeToStderr,
    colour: Boolean(process.stdout.isTTY),
    debug: Boolean(settings.debug),
    fallback,
  };
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
    return failWith(err.message, err.oclif.exit, output);
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
