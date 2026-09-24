import { LaunchNetworkError } from './errors';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  HttpMethod,
  MAX_RETRY_AFTER_MS,
  RetryPolicy,
  retryAfterMs,
} from './retry-policy';

function retryable(): LaunchNetworkError {
  return new LaunchNetworkError('Could not reach the Launch API.', new Error('socket hang up'), true);
}

function fatal(): LaunchNetworkError {
  return new LaunchNetworkError('Proxy error.', new Error('connect ECONNREFUSED'), false);
}

const ALL_METHODS: HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'];

describe('RetryPolicy', () => {
  it('defaults to three retries a second apart when no options are supplied', () => {
    const policy = new RetryPolicy();

    expect(policy.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(policy.retryDelayMs).toBe(DEFAULT_RETRY_DELAY_MS);
    expect(DEFAULT_MAX_RETRIES).toBe(3);
    expect(DEFAULT_RETRY_DELAY_MS).toBe(1000);
  });

  it('takes the configured retry budget and delay over the defaults', () => {
    const policy = new RetryPolicy({ maxRetries: 5, retryDelayMs: 25 });

    expect(policy.maxRetries).toBe(5);
    expect(policy.retryDelayMs).toBe(25);
  });

  it.each([[0], [null as unknown as undefined]])('treats a %p retry budget as configured rather than absent', (value) => {
    const policy = new RetryPolicy({ maxRetries: value, retryDelayMs: value });

    expect(policy.maxRetries).toBe(value ?? DEFAULT_MAX_RETRIES);
    expect(policy.retryDelayMs).toBe(value ?? DEFAULT_RETRY_DELAY_MS);
  });

  it.each(ALL_METHODS)('treats a 429 on %s as retryable whatever the method', (method) => {
    expect(new RetryPolicy().isRetryableStatus(429, method)).toBe(true);
  });

  it.each(['GET', 'HEAD'] as HttpMethod[])('treats a 408 on the idempotent %s as retryable', (method) => {
    expect(new RetryPolicy().isRetryableStatus(408, method)).toBe(true);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'] as HttpMethod[])(
    'treats a 408 on the non-idempotent %s as not retryable',
    (method) => {
      expect(new RetryPolicy().isRetryableStatus(408, method)).toBe(false);
    },
  );

  it.each([502, 503, 504])('treats a %i as retryable only on the idempotent GET and HEAD', (status) => {
    const policy = new RetryPolicy();

    expect(ALL_METHODS.map((method) => [method, policy.isRetryableStatus(status, method)])).toEqual(
      ALL_METHODS.map((method) => [method, method === 'GET' || method === 'HEAD']),
    );
  });

  it('waits the longer of its own backoff and the delay the server asked for', () => {
    const policy = new RetryPolicy({ retryDelayMs: 1000 });

    expect(policy.delayFor(2)).toBe(2000);
    expect(policy.delayFor(2, 1999)).toBe(2000);
    expect(policy.delayFor(2, 2001)).toBe(2001);
    expect(policy.delayFor(2, 0)).toBe(2000);
  });

  it.each([[200], [301], [400], [401], [404], [409], [500], [501], [505]])(
    'treats %i as not retryable on any method',
    (status) => {
      const policy = new RetryPolicy();

      expect(ALL_METHODS.map((method) => policy.isRetryableStatus(status, method))).toEqual(
        ALL_METHODS.map(() => false),
      );
    },
  );

  it('stops retrying once the attempts made reach the budget', () => {
    const policy = new RetryPolicy({ maxRetries: 2 });

    expect(policy.shouldRetry(429, 'GET', 0)).toBe(true);
    expect(policy.shouldRetry(429, 'GET', 1)).toBe(true);
    expect(policy.shouldRetry(429, 'GET', 2)).toBe(false);
    expect(policy.shouldRetry(429, 'GET', 3)).toBe(false);
  });

  it('never retries a non-retryable status even on the first attempt', () => {
    expect(new RetryPolicy().shouldRetry(408, 'POST', 0)).toBe(false);
  });

  it('never retries anything when the budget is zero', () => {
    expect(new RetryPolicy({ maxRetries: 0 }).shouldRetry(429, 'GET', 0)).toBe(false);
  });

  it.each(['GET', 'HEAD'] as HttpMethod[])('treats a retryable transport failure on the idempotent %s as retryable', (method) => {
    expect(new RetryPolicy().isRetryableTransportError(retryable(), method)).toBe(true);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'] as HttpMethod[])(
    'treats a retryable transport failure on the non-idempotent %s as not retryable',
    (method) => {
      expect(new RetryPolicy().isRetryableTransportError(retryable(), method)).toBe(false);
    },
  );

  it.each(ALL_METHODS)('treats a transport failure marked fatal on %s as not retryable', (method) => {
    expect(new RetryPolicy().isRetryableTransportError(fatal(), method)).toBe(false);
  });

  it.each([[null], [undefined], ['boom'], [new Error('plain')], [{ code: 'ECONNRESET' }]])(
    'treats the undiagnosed rejection %p as not retryable',
    (error) => {
      expect(new RetryPolicy().isRetryableTransportError(error, 'GET')).toBe(false);
    },
  );

  it('stops retrying a transport failure once the attempts made reach the budget', () => {
    const policy = new RetryPolicy({ maxRetries: 2 });

    expect(policy.shouldRetryTransportError(retryable(), 'GET', 0)).toBe(true);
    expect(policy.shouldRetryTransportError(retryable(), 'GET', 1)).toBe(true);
    expect(policy.shouldRetryTransportError(retryable(), 'GET', 2)).toBe(false);
    expect(policy.shouldRetryTransportError(retryable(), 'POST', 0)).toBe(false);
  });

  it('backs off by the delay multiplied by the attempt number', () => {
    const policy = new RetryPolicy({ retryDelayMs: 10 });

    expect([1, 2, 3].map((attempt) => policy.delayFor(attempt))).toEqual([10, 20, 30]);
    expect(policy.delayFor(0)).toBe(0);
  });
});

describe('retryAfterMs', () => {
  it.each<[string, Record<string, unknown> | undefined, number | undefined]>([
    ['whole seconds', { 'retry-after': '7' }, 7000],
    ['seconds padded with spaces', { 'retry-after': ' 3 ' }, 3000],
    ['zero seconds', { 'retry-after': '0' }, 0],
    ['exactly the cap', { 'retry-after': '30' }, MAX_RETRY_AFTER_MS],
    ['more than the cap', { 'retry-after': '31' }, MAX_RETRY_AFTER_MS],
    ['an HTTP date', { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' }, undefined],
    ['a negative number', { 'retry-after': '-5' }, undefined],
    ['a fraction', { 'retry-after': '1.5' }, undefined],
    ['an empty value', { 'retry-after': '' }, undefined],
    ['a non-string value', { 'retry-after': 7 }, undefined],
    ['no such header', {}, undefined],
    ['no headers at all', undefined, undefined],
  ])('reads %s', (_label, headers, expected) => {
    expect(retryAfterMs(headers)).toBe(expected);
  });

  it('caps a server-requested wait at thirty seconds', () => {
    expect(MAX_RETRY_AFTER_MS).toBe(30_000);
  });
});
