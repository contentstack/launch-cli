import type { DeploymentLog } from './types';

export const DEPLOYMENT_LOGS_FROM = new Date(0).toISOString();

interface LogCursor {
  at: number;
  printed: Map<string, number>;
}

function logIdentity(log: DeploymentLog): string {
  return JSON.stringify([log.stage, log.message]);
}

function timeOf(log: DeploymentLog): number {
  return log.timestamp ? Date.parse(log.timestamp) : Number.NaN;
}

export class LogTail {
  private cursor: LogCursor | undefined;

  since(): string {
    return this.cursor === undefined ? DEPLOYMENT_LOGS_FROM : new Date(this.cursor.at - 1).toISOString();
  }

  fresh(logs: DeploymentLog[]): DeploymentLog[] {
    const resumeAt = this.cursor?.at;
    const repeats = new Map(this.cursor?.printed);
    const fresh: DeploymentLog[] = [];

    for (const log of logs) {
      const at = timeOf(log);
      const identity = logIdentity(log);
      const seen = repeats.get(identity) ?? 0;

      if (at === resumeAt && seen > 0) {
        repeats.set(identity, seen - 1);
        continue;
      }

      fresh.push(log);
      this.remember(at, identity);
    }

    return fresh;
  }

  private remember(at: number, identity: string): void {
    if (Number.isNaN(at)) {
      return;
    }

    if (this.cursor === undefined || at !== this.cursor.at) {
      this.cursor = { at, printed: new Map() };
    }

    this.cursor.printed.set(identity, (this.cursor.printed.get(identity) ?? 0) + 1);
  }
}
