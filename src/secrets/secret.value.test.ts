import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { SecretInputTimeoutError } from './secrets.errors';
import type { SecretValueIo } from './secret.value';
import { DEFAULT_SECRET_IO, STDIN_TIMEOUT_MS, readSecretValue, readWithin } from './secret.value';

function ioOf(read: () => Promise<string>, stdinTimeoutMs = 1000) {
  const closed: string[] = [];
  const io: SecretValueIo = {
    readStdin: read,
    closeStdin: () => {
      closed.push('closed');
    },
    stdinTimeoutMs,
  };

  return { io, closed };
}

function servicesOf(isTTY: boolean, answer: unknown = undefined) {
  const prompts: Record<string, unknown>[] = [];
  const ux: UxLike = {
    print: () => undefined,
    inquire: async (payload: unknown) => {
      prompts.push(payload as Record<string, unknown>);
      return answer as never;
    },
  };

  return { services: { ux, isTTY } as unknown as ServiceContext, prompts };
}

describe('readWithin', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers with what was read and leaves no timer running', async () => {
    const { io, closed } = ioOf(async () => 'abc');

    await expect(readWithin(io)).resolves.toBe('abc');
    expect(jest.getTimerCount()).toBe(0);
    expect(closed).toEqual([]);
  });

  it('propagates a read failure and leaves no timer running', async () => {
    const failure = new Error('stdin broke');
    const { io, closed } = ioOf(async () => Promise.reject(failure));

    await expect(readWithin(io)).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
    expect(closed).toEqual([]);
  });

  it('ends with a timeout error at exactly the limit, not a millisecond before, and closes stdin', async () => {
    const { io, closed } = ioOf(() => new Promise<string>(() => undefined), 2500);
    const outcome = readWithin(io).catch((error: unknown) => error);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(2499);
    expect(settled).toBe(false);
    expect(closed).toEqual([]);

    await jest.advanceTimersByTimeAsync(1);
    const error = await outcome;

    expect(error).toBeInstanceOf(SecretInputTimeoutError);
    expect((error as Error).message).toContain('within 3 seconds');
    expect(closed).toEqual(['closed']);
  });

  it('names one second in the singular when the limit is one', async () => {
    const { io } = ioOf(() => new Promise<string>(() => undefined), 1000);
    const outcome = readWithin(io).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(1000);

    expect(((await outcome) as Error).message).toContain('within 1 second,');
  });

  it('ignores a read that fails after the timeout has already ended it', async () => {
    let fail: (error: Error) => void = () => undefined;
    const { io } = ioOf(() => new Promise<string>((_resolve, reject) => { fail = reject; }), 10);
    const outcome = readWithin(io).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(10);
    fail(new Error('premature close'));
    await Promise.resolve();

    expect(await outcome).toBeInstanceOf(SecretInputTimeoutError);
  });
});

describe('readSecretValue', () => {
  it('asks a masked prompt that names the key, and reads no stdin, on a terminal', async () => {
    const value = randomUUID();
    const { services, prompts } = servicesOf(true, value);
    const { io } = ioOf(async () => {
      throw new Error('stdin must not be read');
    });

    await expect(readSecretValue('API_TOKEN', services, io)).resolves.toBe(value);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ type: 'password', message: 'Value for API_TOKEN', mask: '*' });
  });

  it('reads standard input, and prompts for nothing, when there is no terminal', async () => {
    const value = randomUUID();
    const { services, prompts } = servicesOf(false);
    const { io } = ioOf(async () => value);

    await expect(readSecretValue('API_TOKEN', services, io)).resolves.toBe(value);
    expect(prompts).toEqual([]);
  });

  it.each([
    ['one LF', 'abc\n', 'abc'],
    ['one CRLF', 'abc\r\n', 'abc'],
    ['two LFs, of which only one is stripped', 'abc\n\n', 'abc\n'],
    ['an LF then a CRLF, of which only the last is stripped', 'abc\n\r\n', 'abc\n'],
    ['no newline', 'abc', 'abc'],
    ['a newline inside the value', 'a\nb', 'a\nb'],
    ['a lone CR, which is not a line ending', 'abc\r', 'abc\r'],
    ['inner and trailing whitespace, kept as typed', '  a b  \n', '  a b  '],
    ['only a newline', '\n', ''],
    ['nothing', '', ''],
  ])('strips exactly one trailing newline from %s', async (_label, piped, expected) => {
    const { services } = servicesOf(false);
    const { io } = ioOf(async () => piped);

    await expect(readSecretValue('K', services, io)).resolves.toBe(expected);
  });

  it('ends with the timeout error when standard input never ends', async () => {
    const { services } = servicesOf(false);
    const { io, closed } = ioOf(() => new Promise<string>(() => undefined), 20);

    await expect(readSecretValue('K', services, io)).rejects.toBeInstanceOf(SecretInputTimeoutError);
    expect(closed).toEqual(['closed']);
  });

  it('propagates a failed read', async () => {
    const { services } = servicesOf(false);
    const failure = new Error('read failed');
    const { io } = ioOf(async () => Promise.reject(failure));

    await expect(readSecretValue('K', services, io)).rejects.toBe(failure);
  });

  it('propagates a cancelled prompt', async () => {
    const { services } = servicesOf(true, undefined);
    const { io } = ioOf(async () => 'unused');

    await expect(readSecretValue('K', services, io)).rejects.toMatchObject({ exitCode: 3 });
  });
});

describe('DEFAULT_SECRET_IO', () => {
  it('waits 30 seconds for standard input', () => {
    expect(STDIN_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_SECRET_IO.stdinTimeoutMs).toBe(STDIN_TIMEOUT_MS);
  });

  it('reads the piped stream of the process', async () => {
    const value = randomUUID();
    const stream = Readable.from([`${value}\n`]);
    const original = Object.getOwnPropertyDescriptor(process, 'stdin');

    Object.defineProperty(process, 'stdin', { value: stream, configurable: true });

    try {
      await expect(DEFAULT_SECRET_IO.readStdin()).resolves.toBe(`${value}\n`);
    } finally {
      Object.defineProperty(process, 'stdin', original as PropertyDescriptor);
    }
  });

  it('closes the stream of the process by destroying it', () => {
    const destroyed: string[] = [];
    const original = Object.getOwnPropertyDescriptor(process, 'stdin');
    const stream = { destroy: () => destroyed.push('destroyed') };

    Object.defineProperty(process, 'stdin', { value: stream, configurable: true });

    try {
      DEFAULT_SECRET_IO.closeStdin();
    } finally {
      Object.defineProperty(process, 'stdin', original as PropertyDescriptor);
    }

    expect(destroyed).toEqual(['destroyed']);
  });
});
