import { LaunchNetworkError } from './errors';

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 1000;
export const IDEMPOTENT_METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];
export const RETRYABLE_STATUSES: readonly number[] = [429];
export const IDEMPOTENT_ONLY_RETRYABLE_STATUSES: readonly number[] = [408, 502, 503, 504];
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const MAX_RETRY_AFTER_MS = 30_000;

export function retryAfterMs(headers: Record<string, unknown> | undefined): number | undefined {
  const value = headers?.['retry-after'];

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return undefined;
  }

  return Math.min(Number(value.trim()) * 1000, MAX_RETRY_AFTER_MS);
}

export interface RetryPolicyOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export class RetryPolicy {
  readonly maxRetries: number;
  readonly retryDelayMs: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  isRetryableStatus(status: number, method: HttpMethod): boolean {
    if (RETRYABLE_STATUSES.includes(status)) {
      return true;
    }

    return IDEMPOTENT_ONLY_RETRYABLE_STATUSES.includes(status) && IDEMPOTENT_METHODS.includes(method);
  }

  isRetryableTransportError(error: unknown, method: HttpMethod): boolean {
    return error instanceof LaunchNetworkError && error.retryable && IDEMPOTENT_METHODS.includes(method);
  }

  shouldRetryTransportError(error: unknown, method: HttpMethod, attemptsMade: number): boolean {
    return attemptsMade < this.maxRetries && this.isRetryableTransportError(error, method);
  }

  shouldRetry(status: number, method: HttpMethod, attemptsMade: number): boolean {
    return attemptsMade < this.maxRetries && this.isRetryableStatus(status, method);
  }

  delayFor(attempt: number, requestedMs?: number): number {
    return Math.max(this.retryDelayMs * attempt, requestedMs ?? 0);
  }
}
