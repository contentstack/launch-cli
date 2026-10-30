import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { EXIT_RUNTIME } from '../core/constants';
import { NoValueError, STDIN_TIMEOUT_MS, readSecretValue } from './secrets.value';

function hanging(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<unknown>>(() => undefined) }),
  };
}

describe('reading a secret value from stdin', () => {
  it('bounds the read at thirty seconds', () => {
    expect(STDIN_TIMEOUT_MS).toBe(30000);
  });

  it('joins every chunk and drops one trailing line break', async () => {
    const value = randomUUID();

    await expect(
      readSecretValue(Readable.from([value.slice(0, 10), Buffer.from(`${value.slice(10)}\n`)])),
    ).resolves.toBe(value);
    await expect(readSecretValue(Readable.from([`${value}\r\n`]))).resolves.toBe(value);
    await expect(readSecretValue(Readable.from([`${value}\n\n`]))).resolves.toBe(`${value}\n`);
  });

  it('keeps the whitespace inside and around the value', async () => {
    await expect(readSecretValue(Readable.from(['  a b  ']))).resolves.toBe('  a b  ');
  });

  it.each([[[]], [['']], [['\n']], [['\r\n']]])('raises the no-value error for %p', async (chunks) => {
    const failure = await readSecretValue(Readable.from(chunks)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NoValueError);
    expect((failure as NoValueError).exitCode).toBe(EXIT_RUNTIME);
    expect((failure as NoValueError).message).toBe(
      'No value received on stdin; pipe the value in, for example: ' +
        'printf %s "$TOKEN" | csdx launch:secrets:set --key API_TOKEN, ' +
        'or run the command in a terminal to enter it at the prompt.',
    );
  });

  it('gives up on a stream that never ends and says no value was received', async () => {
    const failure = await readSecretValue(hanging(), 20).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NoValueError);
    expect((failure as NoValueError).message).toContain('No value received on stdin');
  });

  it('propagates a stream that fails', async () => {
    const broken = new Readable({ read: () => broken.destroy(new Error('stdin failed')) });

    await expect(readSecretValue(broken)).rejects.toThrow('stdin failed');
  });
});
