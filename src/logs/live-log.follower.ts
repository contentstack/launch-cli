import type { Loader } from '../core/loader';
import { silentLoader, terminalLoader } from '../core/loader';
import type { ServiceContext } from '../core/service-context';
import { isRecord } from '../core/values';
import type { DeploymentScope } from '../deployments/deployment.follower';
import { DEPLOYMENT_MAX_POLL_ERRORS, type WatchTiming } from '../deployments/deployment.watcher';
import { LaunchNetworkError } from '../transport/errors';
import type { StreamFrame } from '../transport/event-stream';
import { RetryPolicy } from '../transport/retry-policy';
import {
  liveSessionEndedLine,
  liveSessionLine,
  liveStreamLostMessage,
  noLiveLinesLine,
  serverLogLine,
} from './logs.presenter';
import type { ServerLog } from './types';

export const LIVE_LOADER_MESSAGE = 'Waiting for live server logs...';

export interface LiveFollowerOptions {
  loader?: Loader;
  columns?: number;
  retry?: RetryPolicy;
}

function parsed(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function isTransient(error: unknown): boolean {
  return error instanceof LaunchNetworkError && error.retryable;
}

export class LiveLogFollower {
  private readonly outputIsTTY: boolean;
  private readonly loader: Loader;
  private readonly retry: RetryPolicy;
  private printed = 0;
  private sessionShown = false;
  private ended = false;
  private connection = new AbortController();

  constructor(
    private readonly services: ServiceContext,
    private readonly timing: Pick<WatchTiming, 'sleep'>,
    private readonly options: LiveFollowerOptions = {},
  ) {
    this.outputIsTTY = services.outputIsTTY === true;
    this.loader = options.loader ?? (this.outputIsTTY ? terminalLoader() : silentLoader);
    this.retry = options.retry ?? new RetryPolicy();
  }

  async follow(scope: DeploymentScope, stop: AbortSignal): Promise<void> {
    try {
      await this.reconnecting(scope, stop);
    } finally {
      this.loader.stop();
    }
  }

  private async reconnecting(scope: DeploymentScope, stop: AbortSignal): Promise<void> {
    let failures = 0;

    for (;;) {
      let delivered = false;
      let lastFailure: unknown;

      this.loader.start(LIVE_LOADER_MESSAGE);

      const connection = new AbortController();
      const relay = (): void => connection.abort(stop.reason);

      this.connection = connection;
      stop.addEventListener('abort', relay, { once: true });

      if (stop.aborted) {
        relay();
      }

      try {
        await this.services.api.liveLogs.open(
          scope,
          {
            onFrame: (frame) => {
              delivered = true;
              this.onFrame(frame);
            },
          },
          connection.signal,
        );
      } catch (error) {
        if (!this.ended && !isTransient(error)) {
          throw error;
        }

        lastFailure = error;
      } finally {
        stop.removeEventListener('abort', relay);
      }

      if (this.ended) {
        return;
      }

      failures = delivered ? 1 : failures + 1;

      if (failures >= DEPLOYMENT_MAX_POLL_ERRORS) {
        throw new LaunchNetworkError(liveStreamLostMessage(failures), lastFailure);
      }

      await this.timing.sleep(this.retry.delayFor(failures), stop);
    }
  }

  private onFrame(frame: StreamFrame): void {
    if (this.ended) {
      return;
    }

    if (frame.event === 'session') {
      this.announceSession(frame.data);
      return;
    }

    if (frame.event === 'session-ended') {
      this.finish();
      return;
    }

    if (frame.event !== undefined) {
      return;
    }

    const entry = parsed(frame.data);

    if (isRecord(entry)) {
      this.printed += 1;
      this.emit(serverLogLine(entry as ServerLog, this.outputIsTTY, this.options.columns));
    }
  }

  private announceSession(data: string): void {
    const session = parsed(data);
    const expiresAt = isRecord(session) ? session.expiresAt : undefined;
    const endsAt = typeof expiresAt === 'string' || typeof expiresAt === 'number' ? new Date(expiresAt).getTime() : NaN;

    if (!this.outputIsTTY || this.sessionShown || Number.isNaN(endsAt)) {
      return;
    }

    this.sessionShown = true;
    this.emit(liveSessionLine(endsAt, this.outputIsTTY));
  }

  private finish(): void {
    this.ended = true;
    this.connection.abort();
    this.loader.stop();
    this.services.ux.print(liveSessionEndedLine());

    if (this.printed === 0) {
      this.services.ux.print(noLiveLinesLine(this.outputIsTTY));
    }
  }

  private emit(line: string): void {
    this.loader.stop();
    this.services.ux.print(line);
    this.loader.start(LIVE_LOADER_MESSAGE);
  }
}
