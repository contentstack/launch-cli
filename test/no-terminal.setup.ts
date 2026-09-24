import { cliux } from '@contentstack/cli-utilities';

import { stdinReportingTTY } from './support/terminal';

let restoreTerminal: () => void = () => undefined;

beforeEach(() => {
  restoreTerminal = stdinReportingTTY(false);

  jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
    const message = String((payload as Record<string, unknown> | undefined)?.message ?? '');
    throw new Error(
      `A test reached a real interactive prompt ("${message}"). Mock it with answerPrompts, or it would ` +
        'block on stdin whenever the suite runs in a real terminal.',
    );
  });
});

afterEach(() => {
  restoreTerminal();
});
