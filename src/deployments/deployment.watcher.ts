import type { UxLike } from '../core/render';
import { RetryPolicy } from '../transport/retry-policy';
import { classifyStatus, normalizeStatus } from './deployment.status';
import {
  deploymentHeartbeatLine,
  deploymentLogLine,
  deploymentLogsUnavailableLine,
  deploymentStatusLine,
} from './deployment.presenter';
import type { Deployment, DeploymentLog } from './types';

export const DEPLOYMENT_POLL_DELAY_MS = 2000;
export const DEPLOYMENT_MAX_BACKOFF_STEPS = 5;
export const DEPLOYMENT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEPLOYMENT_MAX_POLL_ERRORS = 3;
export const DEPLOYMENT_LOGS_FROM = new Date(0).toISOString();

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
  outputIsTTY: boolean;
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
  const backoff = new RetryPolicy({ retryDelayMs: deps.pollDelayMs });
  const deadline = deps.now() + deps.timeoutMs;
  let reported: string | undefined;
  let attempt = 0;
  let consecutiveErrors = 0;
  let logsAfter = DEPLOYMENT_LOGS_FROM;
  let logsFailureReported = false;

  for (;;) {
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

      await deps.sleep(retryIn);
      continue;
    }

    const status = normalizeStatus(deployment.status);
    const kind = classifyStatus(deployment.status);
    const terminal = kind === 'success' || kind === 'failure';
    const changed = status !== reported;

    if (changed && !terminal) {
      deps.ux.print(deploymentStatusLine(deployment, status, kind));
      reported = status;
    }

    let logs: DeploymentLog[] = [];

    try {
      logs = await deps.logs(logsAfter);
    } catch (error) {
      if (!logsFailureReported) {
        deps.ux.print(deploymentLogsUnavailableLine(error));
        logsFailureReported = true;
      }
    }

    for (const log of logs) {
      deps.ux.print(deploymentLogLine(log));

      if (log.timestamp && !Number.isNaN(Date.parse(log.timestamp))) {
        logsAfter = log.timestamp;
      }
    }

    if (terminal) {
      deps.ux.print(deploymentStatusLine(deployment, status, kind));
      return { kind, status, deployment };
    }

    if (!changed && logs.length === 0 && deps.outputIsTTY) {
      deps.ux.print(deploymentHeartbeatLine(status));
    }

    attempt += 1;
    const delay = backoff.delayFor(Math.min(attempt, deps.maxBackoffSteps));

    if (deps.now() + delay >= deadline) {
      return { kind: 'timed-out', status, deployment };
    }

    await deps.sleep(delay);
  }
}
