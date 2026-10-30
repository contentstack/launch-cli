import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { readPipedInput } from '../core/piped-input';

export const STDIN_TIMEOUT_MS = 30000;

export class NoValueError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor() {
    super(
      'No value received on stdin; pipe the value in, for example: ' +
        'printf %s "$TOKEN" | csdx launch:secrets:set --key API_TOKEN, ' +
        'or run the command in a terminal to enter it at the prompt.',
    );
    this.name = 'NoValueError';
  }
}

function silence(timeoutMs: number): { timeout: Promise<never>; stop: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new NoValueError()), timeoutMs);
  });

  return { timeout, stop: () => clearTimeout(timer) };
}

export async function readSecretValue(
  stream: AsyncIterable<unknown> = process.stdin,
  timeoutMs: number = STDIN_TIMEOUT_MS,
): Promise<string> {
  const { timeout, stop } = silence(timeoutMs);

  try {
    const value = (await Promise.race([readPipedInput(stream), timeout])).replace(/\r?\n$/, '');

    if (value === '') {
      throw new NoValueError();
    }

    return value;
  } finally {
    stop();
  }
}
