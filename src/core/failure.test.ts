import { Errors } from '@oclif/core';

import { handleStandaloneFailure, reportFailure } from './failure';

type Reported = Errors.CLIError & { skipOclifErrorHandling?: boolean };

function report(err: Error, options: { colour?: boolean; debug?: boolean } = {}) {
  const lines: string[] = [];
  const fallback = jest.fn(async (original: Error) => {
    throw original;
  });
  const outcome = reportFailure(err, {
    print: (line) => lines.push(line),
    colour: options.colour ?? false,
    debug: options.debug ?? false,
    fallback,
  }).catch((failure: unknown) => failure) as Promise<Reported>;

  return { lines, fallback, outcome };
}

describe('reportFailure', () => {
  it('prints an oclif error once as a lowercase error line and keeps its exit code', async () => {
    const { lines, outcome } = report(new Errors.CLIError('command launch:project:list not found', { exit: 127 }));
    const thrown = await outcome;

    expect(lines).toEqual(['error: command launch:project:list not found']);
    expect(thrown.message).toBe('command launch:project:list not found');
    expect(thrown.oclif.exit).toBe(127);
    expect(thrown.skipOclifErrorHandling).toBe(true);
  });

  it('prints the whole line in red when colour is on', async () => {
    const { lines, outcome } = report(new Errors.CLIError('Nonexistent flag: --json', { exit: 2 }), { colour: true });
    await outcome;

    expect(lines).toEqual(['\u001b[31merror: Nonexistent flag: --json\u001b[39m']);
  });

  it('prints an unexpected failure the same way and exits 1', async () => {
    const { lines, fallback, outcome } = report(new Error('boom'));
    const thrown = await outcome;

    expect(lines).toEqual(['error: boom']);
    expect(thrown.oclif.exit).toBe(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('hands an unexpected failure to oclif under DEBUG so the stack trace is shown', async () => {
    const boom = new Error('boom');
    const { lines, fallback, outcome } = report(boom, { debug: true });

    await expect(outcome).resolves.toBe(boom);
    expect(lines).toEqual([]);
    expect(fallback).toHaveBeenCalledWith(boom);
  });

  it('passes an error it has already printed through untouched instead of printing it again', async () => {
    const first = report(new Errors.CLIError('No environment found with that name or UID.', { exit: 1 }));
    const printed = await first.outcome;

    const second = report(printed);

    await expect(second.outcome).resolves.toBe(printed);
    expect(second.lines).toEqual([]);
  });

  it('lets an exit request pass through untouched and prints nothing', async () => {
    const exit = new Errors.ExitError(3);
    const { lines, outcome } = report(exit);

    await expect(outcome).resolves.toBe(exit);
    expect(lines).toEqual([]);
  });
});

describe('handleStandaloneFailure', () => {
  it('prints an error raised before any command runs, such as an unknown command, as the same error line', async () => {
    const written: string[] = [];
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const handle = jest.spyOn(Errors, 'handle').mockResolvedValue(undefined);

    await handleStandaloneFailure(new Errors.CLIError('command launch:project:list not found', { exit: 2 }));

    stderr.mockRestore();
    const [[handed]] = handle.mock.calls as [[Reported]];
    handle.mockRestore();
    expect(written).toEqual(['error: command launch:project:list not found\n']);
    expect(handed.oclif.exit).toBe(2);
    expect(handed.skipOclifErrorHandling).toBe(true);
  });

  it('does not print a second error line for a failure the command already reported', async () => {
    const written: string[] = [];
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const handle = jest.spyOn(Errors, 'handle').mockResolvedValue(undefined);
    const reported = Object.assign(new Errors.CLIError('No environment found with that name or UID.', { exit: 1 }), {
      skipOclifErrorHandling: true,
    });

    await handleStandaloneFailure(reported);

    stderr.mockRestore();
    const [[handed]] = handle.mock.calls as [[Reported]];
    handle.mockRestore();
    expect(written).toEqual([]);
    expect(handed).toBe(reported);
  });
});
