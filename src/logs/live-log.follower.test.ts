import { randomBytes } from 'node:crypto';

import { cliux } from '@contentstack/cli-utilities';

import type { Loader } from '../core/loader';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { LaunchApiError, LaunchNetworkError } from '../transport/errors';
import type { StreamFrame } from '../transport/event-stream';
import { RetryPolicy } from '../transport/retry-policy';
import type { LiveLogHandlers } from './live-logs.api';
import { LIVE_LOADER_MESSAGE, LiveLogFollower } from './live-log.follower';

const SCOPE = {
  org: randomBytes(9).toString('hex'),
  project: randomBytes(12).toString('hex'),
  environment: randomBytes(12).toString('hex'),
  deployment: randomBytes(12).toString('hex'),
};

const SESSION: StreamFrame = { event: 'session', data: '{"expiresAt":"2026-10-28T14:05:09.000Z"}' };
const ENDED: StreamFrame = { event: 'session-ended', data: '{"reason":"timeout"}' };
const HEARTBEAT: StreamFrame = { event: undefined, data: '' };
const YELLOW = (text: string): string => `\u001b[33m${text}\u001b[39m`;

function log(message: string, timestamp = '2026-10-28T10:00:00.000Z'): StreamFrame {
  return { event: undefined, data: JSON.stringify({ timestamp, message, source: 'edge-function' }) };
}

type Attempt = (handlers: LiveLogHandlers, signal: AbortSignal) => Promise<void>;

function delivering(frames: StreamFrame[], after: () => Promise<void> = async () => undefined): Attempt {
  return async (handlers) => {
    frames.forEach((frame) => handlers.onFrame(frame));
    await after();
  };
}

function failing(error: unknown, frames: StreamFrame[] = []): Attempt {
  return delivering(frames, async () => {
    throw error;
  });
}

const dropped = (): LaunchNetworkError => new LaunchNetworkError('socket closed', undefined, true);

function untilAborted(): Attempt {
  return (_handlers, signal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

function harness(attempts: Attempt[], options: { outputIsTTY?: boolean; columns?: number } = {}) {
  const lines: string[] = [];
  const events: string[] = [];
  const delays: number[] = [];
  const signals: AbortSignal[] = [];
  let opened = 0;
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
      events.push('print');
    },
    inquire: async () => undefined as never,
  };
  const loader: Loader = {
    start: (message) => events.push(`start:${message}`),
    stop: () => events.push('stop'),
  };
  const services = {
    ux,
    outputIsTTY: options.outputIsTTY === true,
    api: {
      liveLogs: {
        open: async (_scope: unknown, handlers: LiveLogHandlers, signal: AbortSignal) => {
          signals.push(signal);
          const attempt = attempts[opened];
          opened += 1;
          await attempt(handlers, signal);
        },
      },
    },
  } as unknown as ServiceContext;
  const stop = new AbortController();
  const sleep = jest.fn(async (ms: number, signal?: AbortSignal) => {
    delays.push(ms);

    if (signal?.aborted) {
      throw signal.reason;
    }
  });
  const follower = new LiveLogFollower(services, { sleep }, {
    loader,
    columns: options.columns,
    retry: new RetryPolicy({ retryDelayMs: 700 }),
  });

  return {
    lines,
    events,
    delays,
    signals,
    stop,
    sleep,
    opens: () => opened,
    follow: () => follower.follow(SCOPE, stop.signal),
  };
}

describe('LiveLogFollower', () => {
  it('T87: prints each log frame through the deployment log line, ignoring the source and keeping the colour on a terminal', async () => {
    const run = harness([delivering([log('\u001b[31mboom\u001b[0m'), ENDED])], { outputIsTTY: true });

    await run.follow();

    expect(run.lines[0]).toBe('\u001b[2m10:00:00\u001b[22m  \u001b[31mboom\u001b[0m');
    expect(run.lines[0]).not.toContain('edge-function');
  });

  it('T87: prints the plain stamped line without escape codes on a pipe', async () => {
    const run = harness([delivering([log('\u001b[31mboom\u001b[0m'), ENDED])]);

    await run.follow();

    expect(run.lines).toEqual(['2026-10-28 10:00:00.000:  boom', 'The live session ended (server limit). Run the command again to keep following.']);
  });

  it('T87: wraps a long line to the terminal width it was given', async () => {
    const run = harness([delivering([log('alpha bravo charlie delta echo foxtrot golf hotel'), ENDED])], {
      outputIsTTY: true,
      columns: 50,
    });

    await run.follow();

    expect(run.lines[0]).toBe(
      '\u001b[2m10:00:00\u001b[22m  alpha bravo charlie delta echo foxtrot\n          golf hotel',
    );
  });

  it.each([
    ['a heartbeat', HEARTBEAT],
    ['a frame that is not JSON', { event: undefined, data: 'hello' }],
    ['a half-written JSON frame', { event: undefined, data: '{"message":' }],
    ['a JSON number', { event: undefined, data: '42' }],
    ['JSON null', { event: undefined, data: 'null' }],
    ['a JSON string', { event: undefined, data: '""' }],
    ['an event this CLI does not know', { event: 'something-new', data: '{"message":"x"}' }],
  ])('T75: skips %s and prints only the one real log line', async (_name, skipped) => {
    const run = harness([delivering([skipped, log('real'), skipped, ENDED])]);

    await run.follow();

    expect(run.lines).toEqual([
      '2026-10-28 10:00:00.000:  real',
      'The live session ended (server limit). Run the command again to keep following.',
    ]);
  });

  it('T85: stops the spinner before every print, restarts it after, and ends stopped on a terminal', async () => {
    const run = harness([delivering([SESSION, log('one'), log('two'), ENDED])], { outputIsTTY: true });

    await run.follow();

    const start = `start:${LIVE_LOADER_MESSAGE}`;
    expect(LIVE_LOADER_MESSAGE).toBe('Waiting for live server logs...');
    expect(run.events).toEqual([
      start,
      'stop', 'print', start,
      'stop', 'print', start,
      'stop', 'print', start,
      'stop', 'print',
      'stop',
    ]);
  });

  it('T85: stops the spinner when the stream fails for good', async () => {
    const run = harness([failing(new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND' }]))]);

    await expect(run.follow()).rejects.toBeInstanceOf(LaunchApiError);

    expect(run.events[run.events.length - 1]).toBe('stop');
  });

  it('T85: starts no spinner and prints no escape code on a pipe by default', async () => {
    const spinner = jest.spyOn(cliux, 'loaderV2').mockReturnValue(undefined as never);
    const printed: string[] = [];
    const services = {
      ux: { print: (message: string) => printed.push(message), inquire: async () => undefined as never },
      outputIsTTY: false,
      api: { liveLogs: { open: async (_s: unknown, handlers: LiveLogHandlers) => handlers.onFrame(ENDED) } },
    } as unknown as ServiceContext;

    await new LiveLogFollower(services, { sleep: async () => undefined }).follow(SCOPE, new AbortController().signal);

    expect(spinner).not.toHaveBeenCalled();
    expect(printed.join('')).not.toContain('\u001b');
  });

  it('T85: draws the real spinner on a terminal by default and stops it', async () => {
    const handle = { id: 'spinner' };
    const spinner = jest.spyOn(cliux, 'loaderV2').mockReturnValue(handle as never);
    const services = {
      ux: { print: () => undefined, inquire: async () => undefined as never },
      outputIsTTY: true,
      api: { liveLogs: { open: async (_s: unknown, handlers: LiveLogHandlers) => handlers.onFrame(ENDED) } },
    } as unknown as ServiceContext;

    await new LiveLogFollower(services, { sleep: async () => undefined }).follow(SCOPE, new AbortController().signal);

    expect(spinner).toHaveBeenNthCalledWith(1, LIVE_LOADER_MESSAGE);
    expect(spinner).toHaveBeenLastCalledWith('done', handle);
  });

  it('T86: prints the session end once, dimmed, on a terminal', async () => {
    const run = harness([delivering([SESSION, ENDED])], { outputIsTTY: true });

    await run.follow();

    expect(run.lines[0]).toBe('\u001b[2mLive session ends at 14:05:09; press Ctrl-C to stop.\u001b[22m');
  });

  it('T86: prints no session line on a pipe', async () => {
    const run = harness([delivering([SESSION, ENDED])]);

    await run.follow();

    expect(run.lines.some((line) => line.includes('Live session ends'))).toBe(false);
  });

  it('T86: does not repeat the session line after a reconnect', async () => {
    const run = harness([delivering([SESSION], async () => undefined), delivering([SESSION, ENDED])], { outputIsTTY: true });

    await run.follow();

    expect(run.lines.filter((line) => line.includes('Live session ends'))).toHaveLength(1);
  });

  it.each([
    ['no expiry', '{}'],
    ['an expiry that is not a date', '{"expiresAt":"soon"}'],
    ['an expiry of the wrong type', '{"expiresAt":true}'],
    ['a body that is not JSON', 'oops'],
    ['a body that is not an object', '7'],
  ])('T86: prints no session line for %s', async (_name, data) => {
    const run = harness([delivering([{ event: 'session', data }, ENDED])], { outputIsTTY: true });

    await run.follow();

    expect(run.lines.some((line) => line.includes('Live session ends'))).toBe(false);
  });

  it('T86: shows the line from a later session frame when the first one had no usable expiry', async () => {
    const run = harness([delivering([{ event: 'session', data: '{}' }, SESSION, ENDED])], { outputIsTTY: true });

    await run.follow();

    expect(run.lines.filter((line) => line.includes('Live session ends at 14:05:09'))).toHaveLength(1);
  });

  it('T86: reads a numeric expiry as epoch milliseconds', async () => {
    const endsAt = Date.parse('2026-10-28T14:05:09.000Z');
    const run = harness([delivering([{ event: 'session', data: JSON.stringify({ expiresAt: endsAt }) }, ENDED])], {
      outputIsTTY: true,
    });

    await run.follow();

    expect(run.lines[0]).toContain('Live session ends at 14:05:09;');
  });

  it('T88: prints the server-limit line, opens once, never sleeps and resolves', async () => {
    const run = harness([delivering([log('one'), ENDED])]);

    await expect(run.follow()).resolves.toBeUndefined();

    expect(run.lines[run.lines.length - 1]).toBe(
      'The live session ended (server limit). Run the command again to keep following.',
    );
    expect(run.opens()).toBe(1);
    expect(run.sleep).not.toHaveBeenCalled();
  });

  it('T88: prints the yellow notice after the end line when the session carried no log line', async () => {
    const run = harness([delivering([SESSION, HEARTBEAT, ENDED])], { outputIsTTY: true });

    await run.follow();

    expect(run.lines.slice(-2)).toEqual([
      'The live session ended (server limit). Run the command again to keep following.',
      YELLOW('No live server logs arrived during this session.'),
    ]);
  });

  it('T88: ends the session even when the socket then fails, without a reconnect', async () => {
    const run = harness([failing(dropped(), [ENDED])]);

    await run.follow();

    expect(run.opens()).toBe(1);
    expect(run.sleep).not.toHaveBeenCalled();
  });

  it('T89: reconnects after a clean end of stream and after a dropped socket with the policy delays', async () => {
    const run = harness([delivering([]), failing(dropped()), delivering([log('back'), ENDED])]);

    await run.follow();

    expect(run.opens()).toBe(3);
    expect(run.delays).toEqual([700, 1400]);
    expect(run.lines[0]).toBe('2026-10-28 10:00:00.000:  back');
  });

  it('T90: gives up after three consecutive failures with three opens and two sleeps', async () => {
    const last = dropped();
    const run = harness([failing(dropped()), failing(dropped()), failing(last)]);

    const error = await run.follow().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect((error as LaunchNetworkError).message).toBe(
      'Lost the connection to the live server logs after 3 attempts. Check your network connection and run the command again.',
    );
    expect((error as LaunchNetworkError).cause).toBe(last);
    expect((error as LaunchNetworkError).retryable).toBe(false);
    expect(run.opens()).toBe(3);
    expect(run.delays).toEqual([700, 1400]);
  });

  it('T90: counts a clean end of stream with nothing delivered as a failure too', async () => {
    const run = harness([delivering([]), delivering([]), delivering([])]);

    const error = await run.follow().catch((caught: unknown) => caught);

    expect((error as LaunchNetworkError).cause).toBeUndefined();
    expect(run.opens()).toBe(3);
  });

  it('T90: starts counting again after a connection that delivered frames', async () => {
    const run = harness([
      failing(dropped()),
      failing(dropped(), [log('a')]),
      failing(dropped()),
      failing(dropped(), [HEARTBEAT]),
      failing(dropped()),
      delivering([ENDED]),
    ]);

    await run.follow();

    expect(run.opens()).toBe(6);
    expect(run.delays).toEqual([700, 700, 1400, 700, 1400]);
  });

  it.each([
    ['a refusal from the API', new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND' }])],
    ['a network failure that is not worth retrying', new LaunchNetworkError('proxy unreachable', undefined, false)],
    ['an error nobody classified', new Error('boom')],
  ])('T90: lets %s through at once without a retry', async (_name, error) => {
    const run = harness([failing(error)]);

    await expect(run.follow()).rejects.toBe(error);

    expect(run.opens()).toBe(1);
    expect(run.sleep).not.toHaveBeenCalled();
  });

  it('T91: prints nothing of its own when the stream is lost, leaving the error to the command', async () => {
    const run = harness([failing(dropped()), failing(dropped()), failing(dropped())], { outputIsTTY: true });

    await run.follow().catch(() => undefined);

    expect(run.lines).toEqual([]);
  });

  it('T92: rejects with the interruption reason when the stream is aborted, handing the signal to the open', async () => {
    const run = harness([untilAborted()]);
    const reason = new Error('Stopped following the logs.');

    const outcome = run.follow().catch((caught: unknown) => caught);
    await Promise.resolve();
    run.stop.abort(reason);

    expect(await outcome).toBe(reason);
    expect(run.signals).toEqual([run.stop.signal]);
    expect(run.events[run.events.length - 1]).toBe('stop');
  });

  it('T93: an abort during the reconnect backoff cancels the sleep and opens nothing more', async () => {
    const reason = new Error('Stopped following the logs.');
    const run = harness([failing(dropped()), delivering([ENDED])]);
    run.sleep.mockImplementation(
      (ms: number, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          run.delays.push(ms);
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          setImmediate(() => run.stop.abort(reason));
        }),
    );

    const error = await run.follow().catch((caught: unknown) => caught);

    expect(error).toBe(reason);
    expect(run.opens()).toBe(1);
    expect(run.delays).toEqual([700]);
    expect(run.events[run.events.length - 1]).toBe('stop');
  });
});
