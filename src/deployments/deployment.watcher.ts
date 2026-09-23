import type { UxLike } from '../core/render';
import { RetryPolicy } from '../transport/retry-policy';
import { classifyStatus, normalizeStatus } from './deployment.status';
import { deploymentHeartbeatLine, deploymentStatusLine } from './deployment.presenter';
import type { Deployment } from './types';

export const DEPLOYMENT_POLL_DELAY_MS = 2000;
export const DEPLOYMENT_MAX_BACKOFF_STEPS = 5;
export const DEPLOYMENT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;

export interface WatchTiming {
  sleep(ms: number): Promise<void>;
  now(): number;
  pollDelayMs: number;
  maxBackoffSteps: number;
  timeoutMs: number;
}

export interface DeploymentWatchDeps extends WatchTiming {
  poll(): Promise<Deployment>;
  ux: UxLike;
  isTTY: boolean;
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

  for (;;) {
    const deployment = await deps.poll();
    const status = normalizeStatus(deployment.status);
    const kind = classifyStatus(deployment.status);

    if (status === reported) {
      if (deps.isTTY) {
        deps.ux.print(deploymentHeartbeatLine(status));
      }
    } else {
      deps.ux.print(deploymentStatusLine(deployment, status, kind));
      reported = status;
    }

    if (kind === 'success' || kind === 'failure') {
      return { kind, status, deployment };
    }

    attempt += 1;
    const delay = backoff.delayFor(Math.min(attempt, deps.maxBackoffSteps));

    if (deps.now() + delay >= deadline) {
      return { kind: 'timed-out', status, deployment };
    }

    await deps.sleep(delay);
  }
}
