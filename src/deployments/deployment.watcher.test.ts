import { randomBytes } from 'node:crypto';

import { UxLike } from '../core/render';
import {
  DEPLOYMENT_MAX_BACKOFF_STEPS,
  DEPLOYMENT_MAX_POLL_ERRORS,
  DEPLOYMENT_POLL_DELAY_MS,
  DEPLOYMENT_WAIT_TIMEOUT_MS,
  defaultWatchTiming,
  watchDeployment,
} from './deployment.watcher';
import { Deployment } from './types';

const UID = randomBytes(12).toString('hex');

function harness(statuses: (string | undefined)[], options: { isTTY?: boolean; timeoutMs?: number } = {}) {
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
    ux,
    isTTY: options.isTTY ?? false,
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
    ux,
    isTTY: false,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    pollDelayMs: 1000,
    maxBackoffSteps: 3,
    timeoutMs: options.timeoutMs ?? 60_000,
  };

  return { deps, lines, pollCount: () => polls };
}

describe('deployment wait loop surviving a failing poll', () => {
  it('keeps waiting through a transient poll failure and reports the terminal status', async () => {
    const blip = new Error('502 Bad Gateway');
    const { deps, lines, pollCount } = failingHarness(['QUEUED', blip, 'DEPLOYING', 'LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(outcome.status).toBe('LIVE');
    expect(pollCount()).toBe(4);
    expect(lines.some((line) => line.includes('502 Bad Gateway'))).toBe(false);
  });

  it('resets its patience after a poll that succeeded between failures', async () => {
    const blip = new Error('503 Service Unavailable');
    const { deps, pollCount } = failingHarness([blip, blip, 'DEPLOYING', blip, blip, 'LIVE']);

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('success');
    expect(pollCount()).toBe(6);
  });

  it('propagates the error once the poll has failed DEPLOYMENT_MAX_POLL_ERRORS times in a row', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, pollCount } = failingHarness([outage]);

    await expect(watchDeployment(deps)).rejects.toThrow('500 Internal Server Error');

    expect(pollCount()).toBe(DEPLOYMENT_MAX_POLL_ERRORS);
  });

  it('propagates the error rather than waiting when the deadline is already behind it', async () => {
    const outage = new Error('500 Internal Server Error');
    const { deps, pollCount } = failingHarness([outage], { timeoutMs: 0 });

    await expect(watchDeployment(deps)).rejects.toThrow('500 Internal Server Error');

    expect(pollCount()).toBe(1);
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
    expect(lines).toEqual([
      '→ Deployment #4 is QUEUED',
      '→ Deployment #4 is DEPLOYING',
      '✔ Deployment #4 is LIVE',
    ]);
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
    expect(lines).toEqual(['→ Deployment #4 is ROLLING_BACK']);
  });

  it('terminates when a status stops being reported at all', async () => {
    const { deps, lines } = harness([undefined], { timeoutMs: 3000 });

    const outcome = await watchDeployment(deps);

    expect(outcome.kind).toBe('timed-out');
    expect(outcome.status).toBe('UNKNOWN');
    expect(lines).toEqual(['→ Deployment #4 is UNKNOWN']);
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
    expect(lines).toEqual(['→ Deployment #4 is DEPLOYING']);
  });

  it('terminates by propagating the error raised when the deployment has vanished', async () => {
    const { deps } = harness(['DEPLOYING']);
    const gone = new Error('No deployment found with that UID.');
    deps.poll = async () => {
      throw gone;
    };

    await expect(watchDeployment(deps)).rejects.toBe(gone);
  });

  it('prints one line per status change and nothing more when there is no terminal', async () => {
    const { deps, lines } = harness(['DEPLOYING', 'DEPLOYING', 'DEPLOYING', 'LIVE']);

    await watchDeployment(deps);

    expect(lines).toEqual(['→ Deployment #4 is DEPLOYING', '✔ Deployment #4 is LIVE']);
    expect(lines.join('\n')).not.toContain('\u001b');
  });

  it('adds a heartbeat line on a terminal and keeps escape codes out of it', async () => {
    const { deps, lines } = harness(['DEPLOYING', 'DEPLOYING', 'LIVE'], { isTTY: true });

    await watchDeployment(deps);

    expect(lines).toEqual([
      '→ Deployment #4 is DEPLOYING',
      '  … still DEPLOYING',
      '✔ Deployment #4 is LIVE',
    ]);
    expect(lines.join('\n')).not.toContain('\u001b');
  });

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

  it('offers a real clock and a real sleep, bounded by the declared timing constants', async () => {
    const timing = defaultWatchTiming();
    const before = timing.now();

    await timing.sleep(0);

    expect(timing.now()).toBeGreaterThanOrEqual(before);
    expect(timing.pollDelayMs).toBe(DEPLOYMENT_POLL_DELAY_MS);
    expect(timing.maxBackoffSteps).toBe(DEPLOYMENT_MAX_BACKOFF_STEPS);
    expect(timing.timeoutMs).toBe(DEPLOYMENT_WAIT_TIMEOUT_MS);
    expect(DEPLOYMENT_WAIT_TIMEOUT_MS).toBeGreaterThan(DEPLOYMENT_POLL_DELAY_MS);
  });
});
