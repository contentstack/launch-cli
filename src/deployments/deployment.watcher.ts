import type { Loader } from '../core/loader';
import type { UxLike } from '../core/prompt';
import { RetryPolicy } from '../transport/retry-policy';
import { LogTail } from './deployment.log-tail';
import { classifyStatus, normalizeStatus } from './deployment.status';
import { deploymentLogLine } from './deployment.presenter';
import type { Deployment, DeploymentLog } from './types';

export const DEPLOYMENT_POLL_DELAY_MS = 2000;
export const DEPLOYMENT_MAX_BACKOFF_STEPS = 5;
export const DEPLOYMENT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEPLOYMENT_MAX_POLL_ERRORS = 3;
export const DEPLOYMENT_LOADER_MESSAGE = 'Loading deployment logs...';

export interface WatchTiming {
  sleep(ms: number): Promise<void>;
  now(): number;
  pollDelayMs: number;
  maxBackoffSteps: number;
  timeoutMs: number;
}

export interface DeploymentWatchDeps extends WatchTiming {
  poll(): Promise<Deployment>;
  logs(after: string): Promise<DeploymentLog[]>;
  ux: UxLike;
  loader: Loader;
  outputIsTTY: boolean;
  stop?: AbortSignal;
  until?(deployment: Deployment): boolean;
}

export type DeploymentOutcomeKind = 'success' | 'failure' | 'timed-out';

export interface DeploymentOutcome {
  kind: DeploymentOutcomeKind;
  status: string;
  deployment: Deployment;
}

export function defaultWatchTiming(): WatchTiming {
  return {
    sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    pollDelayMs: DEPLOYMENT_POLL_DELAY_MS,
    maxBackoffSteps: DEPLOYMENT_MAX_BACKOFF_STEPS,
    timeoutMs: DEPLOYMENT_WAIT_TIMEOUT_MS,
  };
}

export async function watchDeployment(deps: DeploymentWatchDeps): Promise<DeploymentOutcome> {
  try {
    return await waitFor({
      ...deps,
      ux: {
        ...deps.ux,
        print: (message: string) => {
          deps.loader.stop();
          deps.ux.print(message);
        },
      },
    });
  } finally {
    deps.loader.stop();
  }
}

function sleepUnlessStopped(deps: DeploymentWatchDeps, ms: number): Promise<void> {
  const { stop } = deps;

  if (stop === undefined) {
    return deps.sleep(ms);
  }

  if (stop.aborted) {
    return Promise.reject(stop.reason);
  }

  return new Promise<void>((resolve, reject) => {
    const abandon = (): void => reject(stop.reason);

    stop.addEventListener('abort', abandon, { once: true });
    deps.sleep(ms).then(
      () => {
        stop.removeEventListener('abort', abandon);
        resolve();
      },
      (error: unknown) => {
        stop.removeEventListener('abort', abandon);
        reject(error);
      },
    );
  });
}

async function freshLogs(deps: DeploymentWatchDeps, tail: LogTail): Promise<DeploymentLog[]> {
  try {
    return tail.fresh(await deps.logs(tail.since()));
  } catch {
    return [];
  }
}

function untilKind(until: (deployment: Deployment) => boolean, deployment: Deployment): 'success' | 'in-flight' {
  return until(deployment) ? 'success' : 'in-flight';
}

async function waitFor(deps: DeploymentWatchDeps): Promise<DeploymentOutcome> {
  const backoff = new RetryPolicy({ retryDelayMs: deps.pollDelayMs });
  const deadline = deps.now() + deps.timeoutMs;
  let attempt = 0;
  let consecutiveErrors = 0;
  const tail = new LogTail();

  for (;;) {
    deps.stop?.throwIfAborted();

    let deployment: Deployment;

    try {
      deployment = await deps.poll();
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      attempt += 1;
      const retryIn = backoff.delayFor(Math.min(attempt, deps.maxBackoffSteps));

      if (consecutiveErrors >= DEPLOYMENT_MAX_POLL_ERRORS || deps.now() + retryIn >= deadline) {
        throw error;
      }

      await sleepUnlessStopped(deps, retryIn);
      continue;
    }

    deps.stop?.throwIfAborted();

    const status = normalizeStatus(deployment.status);
    const kind = deps.until === undefined ? classifyStatus(deployment.status) : untilKind(deps.until, deployment);
    const terminal = kind === 'success' || kind === 'failure';

    for (const log of await freshLogs(deps, tail)) {
      deps.ux.print(deploymentLogLine(log, deps.outputIsTTY, process.stdout.columns));
    }

    if (terminal) {
      return { kind, status, deployment };
    }

    attempt += 1;
    const delay = backoff.delayFor(Math.min(attempt, deps.maxBackoffSteps));

    if (deps.now() + delay >= deadline) {
      return { kind: 'timed-out', status, deployment };
    }

    deps.loader.start(DEPLOYMENT_LOADER_MESSAGE);
    await sleepUnlessStopped(deps, delay);
  }
}
