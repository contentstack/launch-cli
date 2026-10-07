import type { Loader } from '../core/loader';
import type { UxLike } from '../core/prompt';
import { RetryPolicy } from '../transport/retry-policy';
import { classifyStatus, normalizeStatus } from './deployment.status';
import {
  deploymentLogLine,
  deploymentLogsUnavailableLine,
} from './deployment.presenter';
import type { Deployment, DeploymentLog } from './types';

export const DEPLOYMENT_POLL_DELAY_MS = 2000;
export const DEPLOYMENT_MAX_BACKOFF_STEPS = 5;
export const DEPLOYMENT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEPLOYMENT_MAX_POLL_ERRORS = 3;
export const DEPLOYMENT_LOGS_FROM = new Date(0).toISOString();
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
}

export type DeploymentOutcomeKind = 'success' | 'failure' | 'timed-out';

export interface DeploymentOutcome {
  kind: DeploymentOutcomeKind;
  status: string;
  deployment: Deployment;
}

interface LogCursor {
  at: number;
  printed: Map<string, number>;
}

function logIdentity(log: DeploymentLog): string {
  return JSON.stringify([log.stage, log.message]);
}

function logsSince(cursor: LogCursor | undefined): string {
  return cursor === undefined ? DEPLOYMENT_LOGS_FROM : new Date(cursor.at - 1).toISOString();
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

async function waitFor(deps: DeploymentWatchDeps): Promise<DeploymentOutcome> {
  const backoff = new RetryPolicy({ retryDelayMs: deps.pollDelayMs });
  const deadline = deps.now() + deps.timeoutMs;
  let attempt = 0;
  let consecutiveErrors = 0;
  let cursor: LogCursor | undefined;
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

    let logs: DeploymentLog[] = [];

    try {
      logs = await deps.logs(logsSince(cursor));
    } catch (error) {
      if (!logsFailureReported) {
        deps.ux.print(deploymentLogsUnavailableLine(error));
        logsFailureReported = true;
      }
    }

    const resumeAt = cursor?.at;
    const repeats = new Map(cursor?.printed);

    for (const log of logs) {
      const at = log.timestamp ? Date.parse(log.timestamp) : Number.NaN;
      const identity = logIdentity(log);
      const seen = repeats.get(identity) ?? 0;

      if (at === resumeAt && seen > 0) {
        repeats.set(identity, seen - 1);
        continue;
      }

      deps.ux.print(deploymentLogLine(log, deps.outputIsTTY, process.stdout.columns));

      if (Number.isNaN(at)) {
        continue;
      }

      if (cursor === undefined || at !== cursor.at) {
        cursor = { at, printed: new Map() };
      }

      cursor.printed.set(identity, (cursor.printed.get(identity) ?? 0) + 1);
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
    await deps.sleep(delay);
  }
}
