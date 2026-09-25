import { randomBytes } from 'node:crypto';

import { UxLike } from '../core/render';
import {
  DEPLOYMENT_MAX_BACKOFF_STEPS,
  DEPLOYMENT_MAX_POLL_ERRORS,
  DEPLOYMENT_POLL_DELAY_MS,
  DEPLOYMENT_LOADER_MESSAGE,
  DEPLOYMENT_LOGS_FROM,
  DEPLOYMENT_WAIT_TIMEOUT_MS,
  defaultWatchTiming,
  watchDeployment,
} from './deployment.watcher';
import { Deployment, DeploymentLog } from './types';

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

  it('asks for everything on the first fetch and then only for what came after the last line it printed', async () => {
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
      '2026-09-25T10:00:01.456Z',
      '2026-09-25T10:00:01.456Z',
      '2026-09-25T10:00:02.000Z',
    ]);
    expect(DEPLOYMENT_LOGS_FROM).toBe('1970-01-01T00:00:00.000Z');
  });

  it('reports a failing log fetch once, keeps waiting on the deployment and resumes the logs where it left off', async () => {
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
      '  ! Could not read the deployment logs (Bad gateway). Still waiting on the deployment.',
      '2026-09-25 10:00:05.000:  Build complete',
    ]);
    expect(since).toEqual([
      DEPLOYMENT_LOGS_FROM,
      DEPLOYMENT_LOGS_FROM,
      DEPLOYMENT_LOGS_FROM,
      '2026-09-25T10:00:05.000Z',
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

      expect(since).toEqual([DEPLOYMENT_LOGS_FROM, '2026-09-25T10:00:00.123Z']);
      expect(lines).toContain('two');
    },
  );

  it.each([
    [true, '\u001b[32m2026-09-25 10:00:00.123:  Installing dependencies...\u001b[39m'],
    [false, '2026-09-25 10:00:00.123:  Installing dependencies...'],
  ])('prints a log line in green only when the output is a terminal (terminal: %s)', async (outputIsTTY, line) => {
    const { deps, lines } = streamingHarness(
      ['LIVE'],
      [[{ message: 'Installing dependencies...', timestamp: '2026-09-25T10:00:00.123Z' }]],
      { outputIsTTY },
    );

    await watchDeployment(deps);

    expect(lines).toEqual([line]);
  });

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
    [true, '\u001b[32m2026-09-25 10:00:00.000:  —— Step 4: Packaging ——  [SERVER]  CPU: 0.5 vCPUs\u001b[39m'],
    [false, '2026-09-25 10:00:00.000:  —— Step 4: Packaging ——  [SERVER]  CPU: 0.5 vCPUs'],
  ])(
    'drops the colours a log message carries so every line is one shade (terminal: %s)',
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

