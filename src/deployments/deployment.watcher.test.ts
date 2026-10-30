import { randomBytes } from 'node:crypto';

import type { UxLike } from '../core/prompt';
import { MAX_PAGES } from '../core/constants';
import { DEPLOYMENT_LOGS_FROM } from './deployment.log-tail';
import {
  DEPLOYMENT_MAX_BACKOFF_STEPS,
  DEPLOYMENT_MAX_POLL_ERRORS,
  DEPLOYMENT_POLL_DELAY_MS,
  DEPLOYMENT_LOADER_MESSAGE,
  DEPLOYMENT_WAIT_TIMEOUT_MS,
  defaultWatchTiming,
  watchDeployment,
} from './deployment.watcher';
import type { Deployment, DeploymentLog } from './types';

const UID = randomBytes(12).toString('hex');

function harness(statuses: (string | undefined)[], options: { outputIsTTY?: boolean; timeoutMs?: number } = {}) {
  const lines: string[] = [];
  const slept: number[] = [];
  let clock = 0;
  let polls = 0;

  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };

  const deps = {
    poll: async (): Promise<Deployment> => {
      const index = Math.min(polls, statuses.length - 1);
      polls += 1;
      return { uid: UID, deploymentNumber: 4, status: statuses[index], deploymentUrl: 'site.example.test' };
    },
    logs: async (): Promise<DeploymentLog[]> => [],
    loader: { start: () => undefined, stop: () => undefined },
    ux,
    outputIsTTY: options.outputIsTTY ?? false,
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    pollDelayMs: 1000,
    maxBackoffSteps: 3,
    timeoutMs: options.timeoutMs ?? 60_000,
  };

  return { deps, lines, slept, pollCount: () => polls };
}

function failingHarness(outcomes: (string | Error)[], options: { timeoutMs?: number } = {}) {
  const lines: string[] = [];
  const slept: number[] = [];
  let clock = 0;
  let polls = 0;

  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };

  const deps = {
    poll: async (): Promise<Deployment> => {
      const step = outcomes[Math.min(polls, outcomes.length - 1)];
      polls += 1;

      if (step instanceof Error) {
        throw step;
      }

      return { uid: UID, deploymentNumber: 4, status: step, deploymentUrl: 'site.example.test' };
    },
    logs: async (): Promise<DeploymentLog[]> => [],
    loader: { start: () => undefined, stop: () => undefined },
    ux,
    outputIsTTY: false,
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    pollDelayMs: 1000,
    maxBackoffSteps: 3,
    timeoutMs: options.timeoutMs ?? 60_000,
  };

  return { deps, lines, slept, pollCount: () => polls };
}

describe('deployment wait loop surviving a failing poll', () => {
  it('keeps waiting through a transient poll failure and reports the terminal status', async () => {
    const blip = new Error('502 Bad Gateway');
    const { deps, lines, slept, pollCount } = failingHarness(['QUEUED', blip, 'DEPLOYING', 'LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(outcome.status).toBe('LIVE');
    expect(pollCount()).toBe(4);
    expect(slept).toEqual([1000, 2000, 3000]);
    expect(lines.some((line) => line.includes('502 Bad Gateway'))).toBe(false);
  });

  it('backs off between failing polls by the same growing step the in-flight path uses', async () => {
    const blip = new Error('503 Service Unavailable');
    const { deps, slept, pollCount } = failingHarness([blip, blip, 'LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(pollCount()).toBe(3);
    expect(slept).toEqual([1000, 2000]);
  });

  it('caps the backoff after a failing poll at maxBackoffSteps', async () => {
    const blip = new Error('503 Service Unavailable');
    const { deps, slept } = failingHarness(['DEPLOYING', 'DEPLOYING', 'DEPLOYING', blip, 'LIVE']);

    await watchDeployment(deps);

    expect(slept).toEqual([1000, 2000, 3000, 3000]);
  });

  it('resets its patience after a poll that succeeded between failures', async () => {
    const blip = new Error('503 Service Unavailable');
    const { deps, slept, pollCount } = failingHarness([blip, blip, 'DEPLOYING', blip, blip, 'LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(pollCount()).toBe(6);
    expect(slept).toEqual([1000, 2000, 3000, 3000, 3000]);
  });

  it('propagates the error once the poll has failed DEPLOYMENT_MAX_POLL_ERRORS times in a row', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, slept, pollCount } = failingHarness([outage]);

    await expect(watchDeployment(deps)).rejects.toThrow('500 Internal Server Error');

    expect(pollCount()).toBe(DEPLOYMENT_MAX_POLL_ERRORS);
    expect(slept).toEqual([1000, 2000]);
  });

  it('propagates the error without sleeping when the retry would land exactly on the deadline', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, slept, pollCount } = failingHarness([outage, 'LIVE'], { timeoutMs: 1000 });

    await expect(watchDeployment(deps)).rejects.toThrow('500 Internal Server Error');

    expect(pollCount()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('propagates the error without sleeping when the retry would land past the deadline', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, slept, pollCount } = failingHarness([outage, 'LIVE'], { timeoutMs: 999 });

    await expect(watchDeployment(deps)).rejects.toThrow('500 Internal Server Error');

    expect(pollCount()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('retries a failing poll when the retry lands one millisecond before the deadline', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, slept, pollCount } = failingHarness([outage, 'LIVE'], { timeoutMs: 1001 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(pollCount()).toBe(2);
    expect(slept).toEqual([1000]);
  });
});

describe('deployment wait loop', () => {
  it('stops at LIVE and reports it as a success', async () => {
    const { deps, lines, pollCount } = harness(['QUEUED', 'DEPLOYING', 'LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome).toEqual({
      kind: 'success',
      status: 'LIVE',
      deployment: { uid: UID, deploymentNumber: 4, status: 'LIVE', deploymentUrl: 'site.example.test' },
    });
    expect(pollCount()).toBe(3);
    expect(lines).toEqual([]);
  });

  it('stops at DEPLOYED and reports it as a success', async () => {
    const { deps } = harness(['DEPLOYING', 'DEPLOYED']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(outcome.status).toBe('DEPLOYED');
  });

  it('stops at FAILED, CANCELLED, SKIPPED and ARCHIVED and reports each as a failure', async () => {
    for (const status of ['FAILED', 'CANCELLED', 'SKIPPED', 'ARCHIVED']) {
      const { deps } = harness(['DEPLOYING', status]);

      const outcome = await watchDeployment(deps);

      expect(outcome.kind).toBe('failure');
      expect(outcome.status).toBe(status);
    }
  });

  it('terminates on a deployment that never leaves DEPLOYING, reporting a timeout', async () => {
    const { deps, pollCount, slept } = harness(['DEPLOYING'], { timeoutMs: 10_000 });

    const outcome = await watchDeployment(deps);

    expect(outcome).toEqual({
      kind: 'timed-out',
      status: 'DEPLOYING',
      deployment: { uid: UID, deploymentNumber: 4, status: 'DEPLOYING', deploymentUrl: 'site.example.test' },
    });
    expect(pollCount()).toBe(5);
    expect(slept).toEqual([1000, 2000, 3000, 3000]);
  });

  it('terminates on a status the enum does not contain rather than crashing on it', async () => {
    const { deps, lines } = harness(['ROLLING_BACK'], { timeoutMs: 4000 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('timed-out');
    expect(outcome.status).toBe('ROLLING_BACK');
    expect(lines).toEqual([]);
  });

  it('terminates when a status stops being reported at all', async () => {
    const { deps, lines } = harness([undefined], { timeoutMs: 3000 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('timed-out');
    expect(outcome.status).toBe('UNKNOWN');
    expect(lines).toEqual([]);
  });

  it('terminates by propagating an error that every retry raised again', async () => {
    const { deps, lines } = harness(['DEPLOYING']);
    const boom = new Error('The Launch API could not be reached.');
    let polls = 0;
    deps.poll = async () => {
      polls += 1;

      if (polls >= 2) {
        throw boom;
      }

      return { uid: UID, deploymentNumber: 4, status: 'DEPLOYING' };
    };

    await expect(watchDeployment(deps)).rejects.toBe(boom);
    expect(polls).toBe(1 + DEPLOYMENT_MAX_POLL_ERRORS);
    expect(lines).toEqual([]);
  });

  it('terminates by propagating the error raised when the deployment has vanished', async () => {
    const { deps } = harness(['DEPLOYING']);
    const gone = new Error('No deployment found with that UID.');
    deps.poll = async () => {
      throw gone;
    };

    await expect(watchDeployment(deps)).rejects.toBe(gone);
  });

  it.each([[true], [false]])(
    'prints nothing of its own while waiting, not even the terminal status (terminal: %s)',
    async (outputIsTTY) => {
      const { deps, lines } = harness(['QUEUED', 'QUEUED', 'DEPLOYING', 'DEPLOYING', 'LIVE'], { outputIsTTY });

      await watchDeployment(deps);

      expect(lines).toEqual([]);
    },
  );

  it('backs off between polls instead of looping tight, capping the delay it will wait', async () => {
    const { deps, slept } = harness(['DEPLOYING'], { timeoutMs: 20_000 });

    await watchDeployment(deps);

    expect(slept).toEqual([1000, 2000, 3000, 3000, 3000, 3000, 3000]);
  });

  it('returns the first status when it is already terminal, without sleeping at all', async () => {
    const { deps, slept, pollCount } = harness(['LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(slept).toEqual([]);
    expect(pollCount()).toBe(1);
  });

  it('times out without sleeping when the next poll would land exactly on the deadline', async () => {
    const { deps, slept, pollCount } = harness(['DEPLOYING', 'LIVE'], { timeoutMs: 1000 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('timed-out');
    expect(pollCount()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('times out without sleeping when the next poll would land past the deadline', async () => {
    const { deps, slept, pollCount } = harness(['DEPLOYING', 'LIVE'], { timeoutMs: 999 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('timed-out');
    expect(pollCount()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('polls again when the next poll lands one millisecond before the deadline', async () => {
    const { deps, slept, pollCount } = harness(['DEPLOYING', 'LIVE'], { timeoutMs: 1001 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(pollCount()).toBe(2);
    expect(slept).toEqual([1000]);
  });

  it('offers a real clock and a sleep that resolves only once its delay has elapsed', async () => {
    jest.useFakeTimers({ now: 5000 });
    const timing = defaultWatchTiming();
    let woke = false;

    const sleeping = timing.sleep(1500).then(() => {
      woke = true;
    });
    await jest.advanceTimersByTimeAsync(1499);
    const wokeEarly = woke;
    await jest.advanceTimersByTimeAsync(1);
    await sleeping;
    const now = timing.now();
    jest.useRealTimers();

    expect(wokeEarly).toBe(false);
    expect(woke).toBe(true);
    expect(now).toBe(6500);
    expect(timing.pollDelayMs).toBe(DEPLOYMENT_POLL_DELAY_MS);
    expect(timing.maxBackoffSteps).toBe(DEPLOYMENT_MAX_BACKOFF_STEPS);
    expect(timing.timeoutMs).toBe(DEPLOYMENT_WAIT_TIMEOUT_MS);
  });
});

function streamingHarness(
  statuses: string[],
  pages: (DeploymentLog[] | Error)[],
  options: { outputIsTTY?: boolean } = {},
) {
  const { deps: base, lines } = harness(statuses, options);
  const events: string[] = [];
  const deps = {
    ...base,
    ux: { ...base.ux, print: (message: string) => { events.push(`print ${message}`); base.ux.print(message); } },
    loader: {
      start: (message: string) => events.push(`start ${message}`),
      stop: () => events.push('stop'),
    },
  };
  const since: string[] = [];
  let fetches = 0;

  const logs = async (after: string): Promise<DeploymentLog[]> => {
    since.push(after);
    const page = pages[Math.min(fetches, pages.length - 1)];
    fetches += 1;

    if (page instanceof Error) {
      throw page;
    }

    return page;
  };

  return { deps: { ...deps, logs }, lines, since, events };
}

describe('deployment log streaming', () => {
  it('prints each new log line with its timestamp, as V1 did', async () => {
    const { deps, lines } = streamingHarness(
      ['DEPLOYING', 'LIVE'],
      [
        [
          { message: 'Installing dependencies...', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'Build started', timestamp: '2026-09-25T10:00:01.456Z' },
        ],
        [{ message: 'Deployed successfully', timestamp: '2026-09-25T10:00:09.000Z' }],
      ],
    );

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(lines).toEqual([
      '2026-09-25 10:00:00.123:  Installing dependencies...',
      '2026-09-25 10:00:01.456:  Build started',
      '2026-09-25 10:00:09.000:  Deployed successfully',
    ]);
  });

  it('asks for everything on the first fetch and then from one millisecond before the last line it printed', async () => {
    const { deps, since } = streamingHarness(
      ['DEPLOYING', 'DEPLOYING', 'DEPLOYING', 'LIVE'],
      [
        [
          { message: 'one', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'two', timestamp: '2026-09-25T10:00:01.456Z' },
        ],
        [],
        [{ message: 'three', timestamp: '2026-09-25T10:00:02.000Z' }],
        [],
      ],
    );

    await watchDeployment(deps);

    expect(since).toEqual([
      DEPLOYMENT_LOGS_FROM,
      '2026-09-25T10:00:01.455Z',
      '2026-09-25T10:00:01.455Z',
      '2026-09-25T10:00:01.999Z',
    ]);
    expect(DEPLOYMENT_LOGS_FROM).toBe('1970-01-01T00:00:00.000Z');
  });

  it('prints nothing for a failing log fetch, keeps waiting on the deployment and resumes the logs where it left off', async () => {
    const { deps, lines, since } = streamingHarness(
      ['DEPLOYING', 'DEPLOYING', 'DEPLOYING', 'LIVE'],
      [
        new Error('Bad gateway'),
        new Error('Bad gateway'),
        [{ message: 'Build complete', timestamp: '2026-09-25T10:00:05.000Z' }],
        [],
      ],
    );

    const outcome = await watchDeployment(deps);

    expect(outcome).toEqual(expect.objectContaining({ kind: 'success', status: 'LIVE' }));
    expect(lines).toEqual([
      '2026-09-25 10:00:05.000:  Build complete',
    ]);
    expect(since).toEqual([
      DEPLOYMENT_LOGS_FROM,
      DEPLOYMENT_LOGS_FROM,
      DEPLOYMENT_LOGS_FROM,
      '2026-09-25T10:00:04.999Z',
    ]);
  });

  it('prints a line that shares the last printed millisecond but arrived after the fetch, and none twice', async () => {
    const { deps, lines } = streamingHarness(
      ['DEPLOYING', 'LIVE'],
      [
        [
          { message: 'one', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'two', timestamp: '2026-09-25T10:00:00.123Z' },
        ],
        [
          { message: 'one', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'two', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'three', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'four', timestamp: '2026-09-25T10:00:00.500Z' },
        ],
        [],
      ],
    );

    await watchDeployment(deps);

    expect(lines).toEqual([
      '2026-09-25 10:00:00.123:  one',
      '2026-09-25 10:00:00.123:  two',
      '2026-09-25 10:00:00.123:  three',
      '2026-09-25 10:00:00.500:  four',
    ]);
  });

  it('prints a repeated line again when more copies of it arrive at the last printed millisecond', async () => {
    const { deps, lines } = streamingHarness(
      ['DEPLOYING', 'LIVE'],
      [
        [
          { message: 'retrying', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'retrying', timestamp: '2026-09-25T10:00:00.123Z' },
        ],
        [
          { message: 'retrying', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'retrying', timestamp: '2026-09-25T10:00:00.123Z' },
          { message: 'retrying', timestamp: '2026-09-25T10:00:00.123Z' },
        ],
      ],
    );

    await watchDeployment(deps);

    expect(lines).toEqual([
      '2026-09-25 10:00:00.123:  retrying',
      '2026-09-25 10:00:00.123:  retrying',
      '2026-09-25 10:00:00.123:  retrying',
    ]);
  });

  it.each([[undefined], [''], ['not a time']])(
    'keeps its place when the last log carries the unusable timestamp %j',
    async (timestamp) => {
      const { deps, lines, since } = streamingHarness(
        ['DEPLOYING', 'LIVE'],
        [
          [
            { message: 'one', timestamp: '2026-09-25T10:00:00.123Z' },
            { message: 'two', timestamp },
          ],
          [],
        ],
      );

      await watchDeployment(deps);

      expect(since).toEqual([DEPLOYMENT_LOGS_FROM, '2026-09-25T10:00:00.122Z']);
      expect(lines).toContain('two');
    },
  );

  it.each([
    [true, '\u001b[2m10:00:00\u001b[22m  Installing dependencies...'],
    [false, '2026-09-25 10:00:00.123:  Installing dependencies...'],
  ])(
    'stamps a log line with a dimmed local clock on a terminal and the full utc stamp off one (terminal: %s)',
    async (outputIsTTY, line) => {
      const { deps, lines } = streamingHarness(
        ['LIVE'],
        [[{ message: 'Installing dependencies...', timestamp: '2026-09-25T10:00:00.123Z' }]],
        { outputIsTTY },
      );

      await watchDeployment(deps);

      expect(lines).toEqual([line]);
    },
  );

  it('shows the loader while it waits for more logs and stops it before printing anything', async () => {
    const { deps, events } = streamingHarness(
      ['DEPLOYING', 'DEPLOYING', 'LIVE'],
      [[{ message: 'one', timestamp: '2026-09-25T10:00:00.000Z' }], [], [{ message: 'two', timestamp: '2026-09-25T10:00:01.000Z' }]],
    );

    await watchDeployment(deps);

    expect(events).toEqual([
      'stop',
      'print 2026-09-25 10:00:00.000:  one',
      `start ${DEPLOYMENT_LOADER_MESSAGE}`,
      `start ${DEPLOYMENT_LOADER_MESSAGE}`,
      'stop',
      'print 2026-09-25 10:00:01.000:  two',
      'stop',
    ]);
    expect(DEPLOYMENT_LOADER_MESSAGE).toBe('Loading deployment logs...');
  });

  it('leaves no loader running when the wait times out', async () => {
    const { deps, events } = streamingHarness(['DEPLOYING'], [[]]);

    const outcome = await watchDeployment({ ...deps, timeoutMs: 2500 });

    expect(outcome.kind).toBe('timed-out');
    expect(events.at(-1)).toBe('stop');
  });

  it('leaves no loader running when the poll gives up with an error', async () => {
    const { deps, events } = streamingHarness(['DEPLOYING'], [[]]);
    const gone = new Error('No deployment found with that UID.');
    let polls = 0;
    const failingLater = async () => {
      polls += 1;

      if (polls > 1) {
        throw gone;
      }

      return { uid: UID, status: 'DEPLOYING' };
    };

    await expect(watchDeployment({ ...deps, poll: failingLater })).rejects.toBe(gone);
    expect(events).toEqual([`start ${DEPLOYMENT_LOADER_MESSAGE}`, 'stop']);
  });

  it.each([
    [
      true,
      '\u001b[2m10:00:00\u001b[22m  \u001b[1m\u001b[92m—— Step 4: Packaging ——\u001b[0m  ' +
        '\u001b[34m[SERVER]\u001b[39m  CPU: 0.5 vCPUs',
    ],
    [false, '2026-09-25 10:00:00.000:  —— Step 4: Packaging ——  [SERVER]  CPU: 0.5 vCPUs'],
  ])(
    'keeps the colours the deployment agent sends on a terminal and flattens them off one (terminal: %s)',
    async (outputIsTTY, line) => {
      const message = '\u001b[1m\u001b[92m—— Step 4: Packaging ——\u001b[0m  \u001b[34m[SERVER]\u001b[39m  CPU: 0.5 vCPUs';
      const { deps, lines } = streamingHarness(['LIVE'], [[{ message, timestamp: '2026-09-25T10:00:00.000Z' }]], {
        outputIsTTY,
      });

      await watchDeployment(deps);

      expect(lines[0]).toBe(line);
    },
  );
});

describe('deployment wait loop stopped from outside', () => {
  function stoppable(statuses: string[]) {
    const events: string[] = [];
    const controller = new AbortController();
    let polls = 0;
    let release: () => void = () => undefined;

    const deps = {
      poll: async (): Promise<Deployment> => {
        const status = statuses[Math.min(polls, statuses.length - 1)];
        polls += 1;
        events.push(`poll ${status}`);
        return { uid: UID, status };
      },
      logs: async (): Promise<DeploymentLog[]> => [],
      loader: {
        start: (message: string) => events.push(`start ${message}`),
        stop: () => events.push('stop'),
      },
      ux: { print: (message: string) => events.push(`print ${message}`), inquire: async () => undefined as never },
      outputIsTTY: false,
      sleep: (ms: number) =>
        new Promise<void>((resolve) => {
          events.push(`sleep ${ms}`);
          release = resolve;
        }),
      now: () => 0,
      pollDelayMs: 1000,
      maxBackoffSteps: 3,
      timeoutMs: 60_000,
      stop: controller.signal,
    };

    return { deps, events, controller, polls: () => polls, release: () => release() };
  }

  it('abandons the sleep, stops the loader and rejects with the stop reason when stopped between polls', async () => {
    const { deps, events, controller, polls } = stoppable(['DEPLOYING']);
    const reason = new Error('interrupted');

    const waiting = watchDeployment(deps).catch((error: Error) => error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(reason);

    expect(await waiting).toBe(reason);
    expect(polls()).toBe(1);
    expect(events).toEqual(['poll DEPLOYING', `start ${DEPLOYMENT_LOADER_MESSAGE}`, 'sleep 1000', 'stop']);
  });

  it('does not poll at all when it is already stopped', async () => {
    const { deps, events, controller, polls } = stoppable(['LIVE']);
    const reason = new Error('already interrupted');
    controller.abort(reason);

    await expect(watchDeployment(deps)).rejects.toBe(reason);
    expect(polls()).toBe(0);
    expect(events).toEqual(['stop']);
  });

  it('stops waiting between failing polls too, rather than retrying once it was told to stop', async () => {
    const { deps, events, controller } = stoppable(['DEPLOYING']);
    const reason = new Error('interrupted during retry');
    const blip = new Error('502 Bad Gateway');
    const failing = { ...deps, poll: async (): Promise<Deployment> => Promise.reject(blip) };

    const waiting = watchDeployment(failing).catch((error: Error) => error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(reason);

    expect(await waiting).toBe(reason);
    expect(events).toEqual(['sleep 1000', 'stop']);
  });

  it.each([
    ['the normal delay', 'DEPLOYING', undefined],
    ['the error backoff', undefined, new Error('502 Bad Gateway')],
  ])(
    'rejects with the stop reason without sleeping when the stop lands while the poll is in flight (%s)',
    async (_label, status, failure) => {
      jest.useFakeTimers();

      try {
        const { deps, events, controller } = stoppable(['DEPLOYING']);
        const reason = new Error('interrupted during the poll');
        const slept: number[] = [];
        const aborting = {
          ...deps,
          poll: async (): Promise<Deployment> => {
            events.push('poll');
            controller.abort(reason);

            if (failure) {
              throw failure;
            }

            return { uid: UID, status };
          },
          sleep: (ms: number) =>
            new Promise<void>((resolve) => {
              slept.push(ms);
              setTimeout(resolve, ms);
            }),
        };

        await expect(watchDeployment(aborting)).rejects.toBe(reason);
        expect(slept).toEqual([]);
        expect(events).toEqual(['poll', 'stop']);
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('rejects with the stop reason without sleeping when the stop lands while the logs are being read', async () => {
    jest.useFakeTimers();

    try {
      const { deps, events, controller } = stoppable(['DEPLOYING']);
      const reason = new Error('interrupted during the logs read');
      const slept: number[] = [];
      const aborting = {
        ...deps,
        logs: async (): Promise<DeploymentLog[]> => {
          controller.abort(reason);
          return [];
        },
        sleep: (ms: number) =>
          new Promise<void>((resolve) => {
            slept.push(ms);
            setTimeout(resolve, ms);
          }),
      };

      await expect(watchDeployment(aborting)).rejects.toBe(reason);
      expect(slept).toEqual([]);
      expect(events).toEqual(['poll DEPLOYING', 'stop']);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects with the stop reason instead of reporting a terminal status that arrived after the stop', async () => {
    const { deps, events, controller } = stoppable(['LIVE']);
    const reason = new Error('interrupted during the final poll');
    const aborting = {
      ...deps,
      poll: async (): Promise<Deployment> => {
        controller.abort(reason);
        return { uid: UID, status: 'LIVE' };
      },
      logs: async (): Promise<DeploymentLog[]> => {
        events.push('logs');
        return [];
      },
    };

    await expect(watchDeployment(aborting)).rejects.toBe(reason);
    expect(events).toEqual(['stop']);
  });

  it('carries on normally when the sleep ends before any stop and ignores a stop that arrives after the end', async () => {
    const { deps, controller, polls, release } = stoppable(['DEPLOYING', 'LIVE']);

    const waiting = watchDeployment(deps);
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    const outcome = await waiting;
    controller.abort(new Error('too late'));

    expect(outcome.kind).toBe('success');
    expect(polls()).toBe(2);
  });

  it('passes a failing sleep through unchanged', async () => {
    const { deps } = stoppable(['DEPLOYING']);
    const broken = new Error('clock failed');

    await expect(watchDeployment({ ...deps, sleep: () => Promise.reject(broken) })).rejects.toBe(broken);
  });
});

function logAt(second: number, message: string): DeploymentLog {
  return { message, timestamp: new Date(Date.UTC(2026, 8, 25, 10, 0, second)).toISOString() };
}

describe('deployment log drain on the terminal poll', () => {
  it('keeps reading from the advancing cursor until nothing new arrives, printing each line once in order and never sleeping', async () => {
    const { deps, lines, since } = streamingHarness(
      ['LIVE'],
      [[logAt(1, 'one')], [logAt(2, 'two')], [logAt(3, 'three')], []],
    );
    const slept: number[] = [];

    const outcome = await watchDeployment({ ...deps, sleep: async (ms) => void slept.push(ms) });

    expect(outcome.kind).toBe('success');
    expect(lines).toEqual([
      '2026-09-25 10:00:01.000:  one',
      '2026-09-25 10:00:02.000:  two',
      '2026-09-25 10:00:03.000:  three',
    ]);
    expect(since).toEqual([
      DEPLOYMENT_LOGS_FROM,
      '2026-09-25T10:00:00.999Z',
      '2026-09-25T10:00:01.999Z',
      '2026-09-25T10:00:02.999Z',
    ]);
    expect(slept).toEqual([]);
  });

  it('reads exactly MAX_PAGES pages when every page brings something new', async () => {
    let reads = 0;
    const { deps, lines } = streamingHarness(['LIVE'], [[]]);
    const logs = async (): Promise<DeploymentLog[]> => {
      reads += 1;
      return [logAt(reads, `line ${reads}`)];
    };

    await watchDeployment({ ...deps, logs });

    expect(reads).toBe(MAX_PAGES);
    expect(lines).toHaveLength(MAX_PAGES);
  });

  it('makes exactly one logs read per in-flight poll and drains only on the terminal one', async () => {
    const { deps, since } = streamingHarness(
      ['QUEUED', 'DEPLOYING', 'LIVE'],
      [[logAt(1, 'a')], [logAt(2, 'b')], [logAt(3, 'c')], [logAt(4, 'd')], []],
    );

    await watchDeployment(deps);

    expect(since).toEqual([
      DEPLOYMENT_LOGS_FROM,
      '2026-09-25T10:00:00.999Z',
      '2026-09-25T10:00:01.999Z',
      '2026-09-25T10:00:02.999Z',
      '2026-09-25T10:00:03.999Z',
    ]);
  });

  it('stops draining on a page that repeats only what was printed, and prints nothing twice', async () => {
    const { deps, lines, since } = streamingHarness(['LIVE'], [[logAt(1, 'one')], [logAt(1, 'one')], [logAt(9, 'never')]]);

    await watchDeployment(deps);

    expect(lines).toEqual(['2026-09-25 10:00:01.000:  one']);
    expect(since).toHaveLength(2);
  });

  it('stops draining silently at a read that fails mid-drain and leaves the outcome alone', async () => {
    const { deps, lines } = streamingHarness(['LIVE'], [[logAt(1, 'one')], new Error('Bad gateway'), [logAt(2, 'two')]]);
    let reads = 0;
    const logs = (after: string): Promise<DeploymentLog[]> => {
      reads += 1;
      return deps.logs(after);
    };

    const outcome = await watchDeployment({ ...deps, logs });

    expect(outcome).toEqual(expect.objectContaining({ kind: 'success', status: 'LIVE' }));
    expect(lines).toEqual([
      '2026-09-25 10:00:01.000:  one',
    ]);
    expect(reads).toBe(2);
  });

  it('prints nothing for log reads that keep failing across polls', async () => {
    const { deps, lines } = streamingHarness(['DEPLOYING', 'LIVE'], [new Error('down'), new Error('down')]);

    const outcome = await watchDeployment(deps);

    expect(outcome).toEqual(expect.objectContaining({ kind: 'success', status: 'LIVE' }));
    expect(lines).toEqual([]);
  });

  it('stops the drain when stopped mid-read, rejecting with the reason, reading no further and stopping the loader last', async () => {
    const controller = new AbortController();
    const reason = new Error('interrupted');
    const { deps, lines, events } = streamingHarness(['LIVE'], [[]]);
    let reads = 0;
    const logs = async (): Promise<DeploymentLog[]> => {
      reads += 1;

      if (reads === 2) {
        controller.abort(reason);
      }

      return [logAt(reads, `line ${reads}`)];
    };

    await expect(watchDeployment({ ...deps, logs, stop: controller.signal })).rejects.toBe(reason);

    expect(reads).toBe(2);
    expect(lines).toEqual(['2026-09-25 10:00:01.000:  line 1']);
    expect(events.at(-1)).toBe('stop');
  });
});

describe('deployment wait loop already stopped when it would sleep', () => {
  function stoppedAtSleep(statuses: string[]) {
    const controller = new AbortController();
    const slept: number[] = [];
    const { deps: base } = harness(statuses);
    const deps = {
      ...base,
      stop: controller.signal,
      sleep: async (ms: number) => void slept.push(ms),
    };

    return { deps, controller, slept };
  }

  it('ends with the stop reason without sleeping when the signal was aborted while the poll was pending', async () => {
    const { deps, controller, slept } = stoppedAtSleep(['DEPLOYING', 'LIVE']);
    const reason = new Error('interrupted during the poll');
    const poll = deps.poll;

    await expect(
      watchDeployment({
        ...deps,
        poll: async () => {
          const deployment = await poll();
          controller.abort(reason);
          return deployment;
        },
      }),
    ).rejects.toBe(reason);

    expect(slept).toEqual([]);
  });

  it('ends with the stop reason without sleeping when the signal was aborted during the logs read of an in-flight poll', async () => {
    const { deps, controller, slept } = stoppedAtSleep(['DEPLOYING', 'LIVE']);
    const reason = new Error('interrupted during the logs read');

    await expect(
      watchDeployment({
        ...deps,
        logs: async () => {
          controller.abort(reason);
          return [];
        },
      }),
    ).rejects.toBe(reason);

    expect(slept).toEqual([]);
  });

  it('does not sleep when the signal was aborted just as the loader started', async () => {
    const { deps, controller, slept } = stoppedAtSleep(['DEPLOYING', 'LIVE']);
    const reason = new Error('interrupted at the loader');

    await expect(
      watchDeployment({
        ...deps,
        loader: { start: () => controller.abort(reason), stop: () => undefined },
      }),
    ).rejects.toBe(reason);

    expect(slept).toEqual([]);
  });

  it('does not sleep between failing polls when the signal was aborted by the time the retry would wait', async () => {
    const { deps, controller, slept } = stoppedAtSleep(['DEPLOYING']);
    const reason = new Error('interrupted during the failing poll');

    await expect(
      watchDeployment({
        ...deps,
        poll: async () => {
          controller.abort(reason);
          throw new Error('502');
        },
      }),
    ).rejects.toBe(reason);

    expect(slept).toEqual([]);
  });

  it('leaves no timer and no abort listener behind when stopped during the real sleep', async () => {
    jest.useRealTimers();
    const controller = new AbortController();
    const reason = new Error('interrupted in the real sleep');
    const timers = (): number => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
    const before = timers();
    const { deps } = harness(['DEPLOYING']);

    const waiting = watchDeployment({
      ...deps,
      sleep: defaultWatchTiming().sleep,
      stop: controller.signal,
      pollDelayMs: 600_000,
      timeoutMs: 24 * 60 * 60 * 1000,
    }).catch((error: unknown) => error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const during = timers();
    controller.abort(reason);
    const settled = await waiting;

    expect(during).toBe(before + 1);
    expect(settled).toBe(reason);
    expect(timers()).toBe(before);
  });

  it('rejects an already aborted signal at once from the default sleep without arming a timer', async () => {
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);
    const timers = (): number => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
    const before = timers();

    await expect(defaultWatchTiming().sleep(600_000, controller.signal)).rejects.toBe(reason);

    expect(timers()).toBe(before);
  });
});

describe('deployment wait loop with an until condition', () => {
  const isLive = (deployment: Deployment): boolean => deployment.status === 'LIVE';

  it('keeps waiting through statuses that would otherwise end the wait until the condition holds', async () => {
    const { deps, slept, pollCount } = harness(['ARCHIVED', 'FAILED', 'DEPLOYED', 'LIVE']);

    const outcome = await watchDeployment({ ...deps, until: isLive });

    expect(outcome.kind).toBe('success');
    expect(outcome.status).toBe('LIVE');
    expect(pollCount()).toBe(4);
    expect(slept).toEqual([1000, 2000, 3000]);
  });

  it('hands every polled deployment to the condition', async () => {
    const { deps } = harness(['ARCHIVED', 'LIVE']);
    const seen: (string | undefined)[] = [];

    await watchDeployment({
      ...deps,
      until: (deployment) => {
        seen.push(deployment.status);
        return isLive(deployment);
      },
    });

    expect(seen).toEqual(['ARCHIVED', 'LIVE']);
  });

  it('reports a timeout with the last status when the condition never holds', async () => {
    const { deps, slept, pollCount } = harness(['ARCHIVED'], { timeoutMs: 5000 });

    const outcome = await watchDeployment({ ...deps, until: isLive });

    expect(outcome.kind).toBe('timed-out');
    expect(outcome.status).toBe('ARCHIVED');
    expect(slept).toEqual([1000, 2000]);
    expect(pollCount()).toBe(3);
  });

  it('propagates a poll failure that keeps recurring', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, pollCount } = failingHarness([outage]);

    await expect(watchDeployment({ ...deps, until: isLive })).rejects.toThrow('500 Internal Server Error');

    expect(pollCount()).toBe(DEPLOYMENT_MAX_POLL_ERRORS);
  });
});
