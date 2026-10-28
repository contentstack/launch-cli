import { UsageError } from '../core/errors';
import { isAbsent } from '../core/values';

export const DEFAULT_LOG_WINDOW_MS = 3_600_000;

export const SERVER_LOG_RETENTION_MS = 86_400_000;

const MAX_DATE_MS = 8.64e15;

const MS_BY_UNIT: Record<string, number> = {
  s: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
};

const RELATIVE = /^(\d+)(s|min|m|hr|h|d)$/i;

const ABSOLUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const MIXED_PAIR = '--since and --until must both be relative (like 12hr) or both absolute (ISO 8601) timestamps.';

export interface LogWindowInput {
  since?: string | null;
  until?: string | null;
}

export interface LogWindow {
  startTime: number;
  endTime: number;
  clampedFrom?: number;
}

type Kind = 'relative' | 'absolute';

interface Reading {
  kind: Kind;
  value: number;
}

function badValue(flag: string, value: string): UsageError {
  return new UsageError(
    `--${flag} must be a relative time like 12hr (units s, m, h, d) or an ISO 8601 timestamp ` +
      `with an offset like 2025-01-15T10:00:00Z; "${value}" is not.`,
  );
}

function isPresent(value: string | null | undefined): value is string {
  return !isAbsent(value);
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function absoluteMs(text: string): number | undefined {
  const match = ABSOLUTE.exec(text);

  if (match === null) {
    return undefined;
  }

  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysIn(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59;

  return valid ? Date.parse(text) : undefined;
}

function relativeOffset(text: string): number | undefined {
  const match = RELATIVE.exec(text);

  if (match === null) {
    return undefined;
  }

  const amount = Number(match[1]);
  const offset = amount * MS_BY_UNIT[match[2].toLowerCase()];

  return amount > 0 && Number.isSafeInteger(offset) ? offset : undefined;
}

function read(flag: string, raw: string, now: number): Reading {
  const text = raw.trim();
  const absolute = absoluteMs(text);

  if (absolute !== undefined) {
    return { kind: 'absolute', value: absolute };
  }

  const offset = relativeOffset(text);

  if (offset === undefined || Math.abs(now - offset) > MAX_DATE_MS) {
    throw badValue(flag, raw);
  }

  return { kind: 'relative', value: now - offset };
}

export function parseLogWindow({ since, until }: LogWindowInput, now: () => number): LogWindow {
  const current = now();
  const start = isPresent(since) ? read('since', since, current) : undefined;
  const end = isPresent(until) ? read('until', until, current) : undefined;

  if (start !== undefined && end !== undefined && start.kind !== end.kind) {
    throw new UsageError(MIXED_PAIR);
  }

  const endTime = end?.value ?? current;
  const startTime = start?.value ?? endTime - DEFAULT_LOG_WINDOW_MS;

  if (startTime > endTime) {
    throw new UsageError('--since must not be later than --until.');
  }

  const oldest = current - SERVER_LOG_RETENTION_MS;

  return { startTime, endTime, ...(startTime < oldest && { clampedFrom: oldest }) };
}
