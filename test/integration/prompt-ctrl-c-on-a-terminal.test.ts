import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { EXIT_CANCELLED } from '../../src/core/constants';

const PTY = join(__dirname, '..', 'support', 'pty');
const PROMPT_ON_SCREEN = 'Choose an environment';

function exitCodeAfterCtrlC(promptType: string): number {
  const output = execFileSync(
    'python3',
    [
      '-I',
      join(PTY, 'press-ctrl-c.py'),
      PROMPT_ON_SCREEN,
      process.execPath,
      '-r',
      'ts-node/register/transpile-only',
      join(PTY, 'ctrl-c-prompt.fixture.ts'),
      promptType,
    ],
    { encoding: 'utf8' },
  );

  return Number(output.trim());
}

// Simulating SIGINT hid CL-8790: in raw mode Ctrl-C reaches inquirer as typed input, so type it for real.
describe('Ctrl-C at a real prompt on a terminal', () => {
  it.each(['input', 'list', 'checkbox', 'confirm', 'search-list'])(
    'exits 3 as cancelled at the %s prompt',
    (promptType) => {
      expect(exitCodeAfterCtrlC(promptType)).toBe(EXIT_CANCELLED);
    },
    60_000,
  );
});
