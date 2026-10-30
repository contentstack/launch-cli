import { randomBytes } from 'node:crypto';

import type { LaunchError } from '../core/errors';
import type { ServiceContext } from '../core/service-context';
import type { ApiSurface } from '../resources';
import { LaunchApiError } from '../transport/errors';
import { DeploymentUnsuccessfulError, DeploymentWaitInterruptedError } from './deployment.errors';
import { DeploymentRollback } from './deployment.rollback';
import type { DeploymentOutcome, WatchTiming } from './deployment.watcher';

const ORG = `blt${randomBytes(8).toString('hex')}`;
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');
const TARGET = randomBytes(12).toString('hex');

const REQUEST = { org: ORG, project: PROJECT, environment: ENVIRONMENT, deployment: TARGET, reason: 'bad release' };
const CHECK =
  `csdx launch:deployments:get --org ${ORG} --project ${PROJECT} --env ${ENVIRONMENT} --deployment ${TARGET}`;

class FakeSignals {
  readonly listeners: (() => void)[] = [];
  readonly registered: string[] = [];

  on(signal: 'SIGINT', listener: () => void): void {
    this.registered.push(signal);
    this.listeners.push(listener);
  }

  removeListener(_signal: 'SIGINT', listener: () => void): void {
    const index = this.listeners.indexOf(listener);

    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  interrupt(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function harness(
  options: {
    outcome?: DeploymentOutcome;
    wait?: (scope: unknown, stop?: AbortSignal) => Promise<DeploymentOutcome>;
    rollbackFails?: Error;
  } = {},
) {
  const timeline: string[] = [];
  const rolledBack: unknown[] = [];
  const waited: { scope: unknown; stop?: AbortSignal }[] = [];
  const signals = new FakeSignals();

  const api = {
    deployments: {
      rollback: async (params: unknown) => {
        timeline.push('rollback');
        rolledBack.push(params);

        if (options.rollbackFails !== undefined) {
          throw options.rollbackFails;
        }
      },
    },
  } as unknown as ApiSurface;

  const services: ServiceContext = {
    api,
    ux: { print: (message: string) => timeline.push(`print ${message}`), inquire: async () => undefined as never },
    isTTY: false,
    outputIsTTY: false,
  };

  const timing: WatchTiming = {
    sleep: async () => undefined,
    now: () => 0,
    pollDelayMs: 1,
    maxBackoffSteps: 1,
    timeoutMs: 1,
  };

  const follower = {
    waitUntilLive: async (scope: unknown, stop?: AbortSignal): Promise<DeploymentOutcome> => {
      timeline.push('wait');
      waited.push({ scope, stop });

      if (options.wait !== undefined) {
        return options.wait(scope, stop);
      }

      return options.outcome ?? { kind: 'success', status: 'LIVE', deployment: { uid: TARGET, status: 'LIVE' } };
    },
  };

  const rollback = new DeploymentRollback(services, timing, { signals, follower });

  return { rollback, signals, timeline, rolledBack, waited };
}

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected the rollback to fail');
    },
    (error: unknown) => error as Error,
  );
}

describe('DeploymentRollback', () => {
  it('sends the rollback, says it started, then waits for the target in its own scope and says nothing more', async () => {
    const { rollback, timeline, rolledBack, waited } = harness();

    await rollback.rollback(REQUEST);

    expect(rolledBack).toEqual([REQUEST]);
    expect(waited.map((call) => call.scope)).toEqual([
      { org: ORG, project: PROJECT, environment: ENVIRONMENT, deployment: TARGET },
    ]);
    expect(timeline).toEqual(['rollback', `print Rollback to deployment "${TARGET}" started.`, 'wait']);
  });

  it('hands an absent reason on as undefined', async () => {
    const { rollback, rolledBack } = harness();

    await rollback.rollback({ ...REQUEST, reason: undefined });

    expect(rolledBack).toEqual([{ ...REQUEST, reason: undefined }]);
  });

  it('propagates a rejected rollback request without announcing a start or waiting', async () => {
    const failure = new LaunchApiError(409, [{ code: 'launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE', message: 'x' }]);
    const { rollback, timeline, waited } = harness({ rollbackFails: failure });

    await expect(rollback.rollback(REQUEST)).rejects.toBe(failure);

    expect(timeline).toEqual(['rollback']);
    expect(waited).toEqual([]);
  });

  it('reports a target that is still not LIVE when the wait ran out, naming the status and deployments:get, exit 1', async () => {
    const { rollback } = harness({
      outcome: { kind: 'timed-out', status: 'ARCHIVED', deployment: { uid: TARGET, status: 'ARCHIVED' } },
    });

    const failure = await failureOf(rollback.rollback(REQUEST));

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as LaunchError).exitCode).toBe(1);
    expect(failure.message).toBe(
      `Deployment "${TARGET}" was still ARCHIVED when the CLI stopped waiting. ` +
        `Run ${CHECK} to check whether the rollback completed.`,
    );
  });

  it('reports a poll error as an unconfirmed rollback with its reason, exit 1', async () => {
    const { rollback } = harness({
      wait: async () => {
        throw new LaunchApiError(503, []);
      },
    });

    const failure = await failureOf(rollback.rollback(REQUEST));

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as LaunchError).exitCode).toBe(1);
    expect(failure.message).toMatch(
      new RegExp(`^The rollback to deployment "${TARGET}" could not be confirmed: .+\\. Run ${CHECK} to check whether`),
    );
    expect(failure.message).not.toContain('successfully');
  });

  it('refuses to call any other outcome a success', async () => {
    const { rollback } = harness({
      outcome: { kind: 'failure', status: 'FAILED', deployment: { uid: TARGET, status: 'FAILED' } },
    });

    const failure = await failureOf(rollback.rollback(REQUEST));

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect(failure.message).toContain('FAILED');
  });
});

describe('DeploymentRollback interrupted with Ctrl-C while waiting', () => {
  function waitingForever(stopHolder: { stop?: AbortSignal }) {
    return (_scope: unknown, stop?: AbortSignal) =>
      new Promise<DeploymentOutcome>((_resolve, reject) => {
        stopHolder.stop = stop;
        stop?.addEventListener('abort', () => reject(stop.reason), { once: true });
      });
  }

  it('stops the wait, says the rollback was not cancelled and names deployments:get, sends nothing more, and exits 3', async () => {
    const holder: { stop?: AbortSignal } = {};
    const { rollback, signals, rolledBack } = harness({ wait: waitingForever(holder) });

    const running = failureOf(rollback.rollback(REQUEST));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(signals.registered).toEqual(['SIGINT']);
    expect(holder.stop?.aborted).toBe(false);

    signals.interrupt();
    const failure = await running;

    expect(holder.stop?.aborted).toBe(true);
    expect(failure).toBeInstanceOf(DeploymentWaitInterruptedError);
    expect((failure as LaunchError).exitCode).toBe(3);
    expect(failure.message).toBe(
      `Stopped waiting. The rollback to deployment "${TARGET}" was not cancelled and continues on Launch. ` +
        `Check it with ${CHECK}.`,
    );
    expect(rolledBack).toHaveLength(1);
    expect(signals.listeners).toEqual([]);
  });

  it('registers no listener when the rollback request is refused', async () => {
    const { rollback, signals } = harness({ rollbackFails: new Error('refused') });

    await failureOf(rollback.rollback(REQUEST));

    expect(signals.registered).toEqual([]);
  });

  it('removes the listener after a wait that ended on its own', async () => {
    const { rollback, signals } = harness();

    await rollback.rollback(REQUEST);

    expect(signals.registered).toEqual(['SIGINT']);
    expect(signals.listeners).toEqual([]);
  });
});
