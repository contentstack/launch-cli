export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 1000;
export const IDEMPOTENT_METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];
export const RETRYABLE_STATUSES: readonly number[] = [429];
export const IDEMPOTENT_ONLY_RETRYABLE_STATUSES: readonly number[] = [408];

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

  shouldRetry(status: number, method: HttpMethod, attemptsMade: number): boolean {
    return attemptsMade < this.maxRetries && this.isRetryableStatus(status, method);
  }

  delayFor(attempt: number): number {
    return this.retryDelayMs * attempt;
  }
}
