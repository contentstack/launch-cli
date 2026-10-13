import { cliux } from '@contentstack/cli-utilities';

import { stdinReportingTTY, stdoutOfWidth, stdoutReportingTTY } from './support/terminal';

let restoreTerminal: (() => void)[] = [];

beforeEach(() => {
  // Pin both streams to what a piped run reports, so a suite run inside a real
  // terminal renders exactly what CI renders — no TTY colouring, no wrapping
  // and no table truncation that depends on how wide the window happens to be.
  restoreTerminal = [stdinReportingTTY(false), stdoutReportingTTY(false), stdoutOfWidth(undefined)];

  jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
    const message = String((payload as Record<string, unknown> | undefined)?.message ?? '');
    throw new Error(
      `A test reached a real interactive prompt ("${message}"). Mock it with answerPrompts, or it would ` +
        'block on stdin whenever the suite runs in a real terminal.',
    );
  });
});

afterEach(() => {
  for (const restore of restoreTerminal.reverse()) {
    restore();
  }

  restoreTerminal = [];
});
