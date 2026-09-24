import { EventEmitter } from 'node:events';

import { CancelledError } from './errors';
import { cancelOnInterrupt, holdEventLoop } from './interruptible-ux';
import { UxLike } from './render';

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
