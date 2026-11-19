import type { DeploymentLog } from './types';

export const DEPLOYMENT_LOGS_FROM = new Date(0).toISOString();
export const DEPLOYMENT_LOG_LOOKBACK_MS = 10_000;

function logIdentity(log: DeploymentLog, at: number): string {
  return JSON.stringify([at, log.stage, log.message]);
}

function timeOf(log: DeploymentLog): number {
  return log.timestamp ? Date.parse(log.timestamp) : Number.NaN;
}

/**
 * Logs become searchable out of timestamp order, so every read re-asks for a look-back window
 * behind the newest line and hands back only the copies of each line not yet handed back.
 */
export class LogTail {
  private newest: number | undefined;
  private readonly printed = new Map<string, number>();

  since(): string {
    if (this.newest === undefined) {
      return DEPLOYMENT_LOGS_FROM;
    }

    return new Date(this.newest - DEPLOYMENT_LOG_LOOKBACK_MS).toISOString();
  }

  fresh(logs: DeploymentLog[]): DeploymentLog[] {
    const seenInThisRead = new Map<string, number>();
    const fresh: DeploymentLog[] = [];

    for (const log of logs) {
      const at = timeOf(log);

      if (Number.isNaN(at)) {
        fresh.push(log);
        continue;
      }

      const identity = logIdentity(log, at);
      const copy = (seenInThisRead.get(identity) ?? 0) + 1;
      seenInThisRead.set(identity, copy);

      if (copy <= (this.printed.get(identity) ?? 0)) {
        continue;
      }

      this.printed.set(identity, copy);
      this.newest = this.newest === undefined ? at : Math.max(this.newest, at);
      fresh.push(log);
    }

    return fresh;
  }
}
