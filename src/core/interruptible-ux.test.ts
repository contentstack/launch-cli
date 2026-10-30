import { EventEmitter } from 'node:events';

import { CancelledError } from './errors';
import { cancelOnInterrupt, holdEventLoop, onInterrupt } from './interruptible-ux';
import type { UxLike } from './prompt';

function pendingUx(): { ux: UxLike; payloads: unknown[]; printed: string[]; settle: (outcome: { value?: unknown; error?: Error }) => void } {
  const payloads: unknown[] = [];
  const printed: string[] = [];
  let settle: (outcome: { value?: unknown; error?: Error }) => void = () => undefined;
  const ux: UxLike = {
    print: (message) => printed.push(message),
    inquire: <T>(payload: unknown) =>
      new Promise<T>((resolve, reject) => {
        payloads.push(payload);
        settle = ({ value, error }) => (error ? reject(error) : resolve(value as T));
      }),
  };

  return { ux, payloads, printed, settle: (outcome) => settle(outcome) };
}

const QUESTION = { type: 'search-list', name: 'value', message: 'Project type' };

function recordingHold(): { hold: () => () => void; events: string[] } {
  const events: string[] = [];

  return {
    events,
    hold: () => {
      events.push('held');
      return () => events.push('released');
    },
  };
}

function activeTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

describe('cancelOnInterrupt', () => {
  it('hands the question through and resolves with the answer, then stops listening for Ctrl-C', async () => {
    const signals = new EventEmitter();
    const inner = pendingUx();
    const loop = recordingHold();

    const answer = cancelOnInterrupt(inner.ux, { signals, hold: loop.hold }).inquire<string>(QUESTION);
    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(loop.events).toEqual(['held']);
    inner.settle({ value: 'GitHub' });

    await expect(answer).resolves.toBe('GitHub');
    expect(inner.payloads).toEqual([QUESTION]);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(loop.events).toEqual(['held', 'released']);
  });

  it('rejects with CancelledError when Ctrl-C arrives while the prompt is open, then stops listening', async () => {
    const signals = new EventEmitter();
    const inner = pendingUx();
    const loop = recordingHold();

    const answer = cancelOnInterrupt(inner.ux, { signals, hold: loop.hold }).inquire<string>(QUESTION);
    signals.emit('SIGINT');
    const error = await answer.catch((e: unknown) => e);
    inner.settle({ value: 'ignored' });
    await new Promise((done) => setImmediate(done));

    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).exitCode).toBe(3);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(loop.events.slice(0, 2)).toEqual(['held', 'released']);
  });

  it('is still listening while a later SIGINT listener runs, so signal-exit does not re-raise it and exit 130', async () => {
    const signals = new EventEmitter();
    const inner = pendingUx();
    const counted: number[] = [];

    const answer = cancelOnInterrupt(inner.ux, { signals, hold: recordingHold().hold }).inquire<string>(QUESTION);
    signals.on('SIGINT', () => counted.push(signals.listenerCount('SIGINT')));
    signals.emit('SIGINT');
    const error = await answer.catch((e: unknown) => e);
    await new Promise((done) => setImmediate(done));

    expect(error).toBeInstanceOf(CancelledError);
    expect(counted).toEqual([2]);
    expect(signals.listenerCount('SIGINT')).toBe(1);
  });

  it('propagates the prompt failure unchanged rather than calling it a cancellation, then stops listening', async () => {
    const signals = new EventEmitter();
    const inner = pendingUx();
    const loop = recordingHold();
    const failure = new Error('terminal went away');

    const answer = cancelOnInterrupt(inner.ux, { signals, hold: loop.hold }).inquire<string>(QUESTION);
    inner.settle({ error: failure });

    await expect(answer).rejects.toBe(failure);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(loop.events).toEqual(['held', 'released']);
  });

  it('propagates a prompt that throws before returning a promise, then stops listening', async () => {
    const signals = new EventEmitter();
    const loop = recordingHold();
    const failure = new Error('no terminal');
    const throwing: UxLike = {
      print: () => undefined,
      inquire: () => {
        throw failure;
      },
    };

    const answer = cancelOnInterrupt(throwing, { signals, hold: loop.hold }).inquire<string>(QUESTION);

    await expect(answer).rejects.toBe(failure);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(loop.events).toEqual(['held', 'released']);
  });

  it('prints through the wrapped ux unchanged', () => {
    const inner = pendingUx();

    cancelOnInterrupt(inner.ux, { signals: new EventEmitter() }).print('Using the organization Acme.');

    expect(inner.printed).toEqual(['Using the organization Acme.']);
  });

  it('listens on the process itself when no signal source is given', async () => {
    const inner = pendingUx();
    const before = process.listenerCount('SIGINT');

    const answer = cancelOnInterrupt(inner.ux).inquire<string>(QUESTION);
    const during = process.listenerCount('SIGINT');
    process.emit('SIGINT');

    await expect(answer).rejects.toBeInstanceOf(CancelledError);
    expect(during).toBe(before + 1);
    inner.settle({ value: 'ignored' });
    await new Promise((done) => setImmediate(done));
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('holds the event loop open while a prompt is pending, because a force-closed prompt leaves nothing else alive', async () => {
    const inner = pendingUx();
    const before = activeTimers();

    const answer = cancelOnInterrupt(inner.ux, { signals: new EventEmitter() }).inquire<string>(QUESTION);
    const during = activeTimers();
    inner.settle({ value: 'GitHub' });
    await answer;

    expect(during).toBe(before + 1);
    expect(activeTimers()).toBe(before);
  });
});

describe('holdEventLoop', () => {
  it('keeps one referenced timer alive until it is released', () => {
    const before = activeTimers();

    const release = holdEventLoop();
    const during = activeTimers();
    release();

    expect(during).toBe(before + 1);
    expect(activeTimers()).toBe(before);
  });
});

describe('onInterrupt', () => {
  it('runs the listener on Ctrl-C once and stops listening when released', async () => {
    const signals = new EventEmitter();
    const calls: string[] = [];

    const release = onInterrupt(() => calls.push('interrupted'), signals);
    const attached = signals.listenerCount('SIGINT');
    signals.emit('SIGINT');
    await new Promise((done) => setImmediate(done));
    signals.emit('SIGINT');

    expect(attached).toBe(1);
    expect(calls).toEqual(['interrupted']);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    release();
  });

  it('removes the listener on Release before any signal, and a second Release is harmless', () => {
    const signals = new EventEmitter();
    const calls: string[] = [];

    const release = onInterrupt(() => calls.push('interrupted'), signals);
    release();
    release();
    signals.emit('SIGINT');

    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(calls).toEqual([]);
  });

  it('is still listening while a later SIGINT listener runs, so signal-exit does not re-raise it and exit 130', async () => {
    const signals = new EventEmitter();
    const counted: number[] = [];

    onInterrupt(() => undefined, signals);
    signals.on('SIGINT', () => counted.push(signals.listenerCount('SIGINT')));
    signals.emit('SIGINT');
    await new Promise((done) => setImmediate(done));

    expect(counted).toEqual([2]);
    expect(signals.listenerCount('SIGINT')).toBe(1);
  });

  it('does not remove a listener that Release already removed when the signal then arrives in the same tick', async () => {
    const signals = new EventEmitter();
    const other = jest.fn();
    signals.on('SIGINT', other);

    const release = onInterrupt(() => undefined, signals);
    signals.emit('SIGINT');
    release();
    release();
    await new Promise((done) => setImmediate(done));

    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('listens on the process itself by default and restores the listener count on Release', () => {
    const before = process.listenerCount('SIGINT');

    const release = onInterrupt(() => undefined);
    const during = process.listenerCount('SIGINT');
    release();

    expect(during).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
