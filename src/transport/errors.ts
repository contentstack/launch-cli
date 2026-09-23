import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError } from '../core/errors';
import { proxyUrl } from './proxy';

export interface ApiErrorEntry {
  code: string;
  message: string;
}

export type ErrorMessages = Record<string, string>;

export function messageForCode(messages: ErrorMessages, code?: string): string | undefined {
  return code === undefined ? undefined : messages[code];
}

export class LaunchApiError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  readonly status: number;
  readonly code: string;
  readonly errors: ApiErrorEntry[];

  constructor(status: number, errors: ApiErrorEntry[], messages: ErrorMessages = {}) {
    const primary = errors[0];
    super(
      messageForCode(messages, primary?.code) ?? primary?.message ?? `Launch API request failed with status ${status}.`,
    );
    this.name = 'LaunchApiError';
    this.status = status;
    this.code = primary?.code ?? 'launch.UNKNOWN';
    this.errors = errors;
  }
}

export function parseErrorEnvelope(status: number, body: unknown, messages: ErrorMessages = {}): LaunchApiError {
  const errors = (body as { errors?: unknown })?.errors;
  return new LaunchApiError(status, Array.isArray(errors) ? (errors as ApiErrorEntry[]) : [], messages);
}

export const PROXY_ERROR_CODES: readonly string[] = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ERR_BAD_RESPONSE'];

export const NETWORK_ERROR_CODES: readonly string[] = [
  'ECONNRESET',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
];

export const NETWORK_ERROR_MESSAGES: readonly string[] = [
  'timeout',
  'Network Error',
  'socket hang up',
  'getaddrinfo',
];

export class LaunchNetworkError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  readonly cause: unknown;

  readonly retryable: boolean;

  constructor(message: string, cause: unknown, retryable = false) {
    super(message);
    this.name = 'LaunchNetworkError';
    this.cause = cause;
    this.retryable = retryable;
  }
}

function looksLikeProxyFailure(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };

  if (typeof code === 'string' && PROXY_ERROR_CODES.includes(code)) {
    return true;
  }

  return typeof message === 'string' && message.includes('ERR_BAD_RESPONSE');
}

function errorCode(error: unknown): string | undefined {
  const { code } = (error ?? {}) as { code?: unknown };
  return typeof code === 'string' && code !== '' ? code : undefined;
}

function looksLikeNetworkFailure(error: unknown): boolean {
  const code = errorCode(error);

  if (code !== undefined && NETWORK_ERROR_CODES.includes(code)) {
    return true;
  }

  const { message } = (error ?? {}) as { message?: unknown };

  return typeof message === 'string' && NETWORK_ERROR_MESSAGES.some((fragment) => message.includes(fragment));
}

function unreachableMessage(error: unknown): string {
  const code = errorCode(error);
  const detail = code === undefined ? '' : ` (${code})`;

  return `Could not reach the Launch API${detail}. Check your network connection and try again.`;
}

export function diagnoseTransportError(error: unknown): unknown {
  if (error instanceof LaunchError) {
    return error;
  }

  if (looksLikeProxyFailure(error)) {
    const url = proxyUrl();

    if (url !== undefined) {
      return new LaunchNetworkError(
        `Proxy error: Unable to connect to proxy server at ${url}. Please verify your proxy configuration.`,
        error,
      );
    }
  }

  if (looksLikeNetworkFailure(error)) {
    return new LaunchNetworkError(unreachableMessage(error), error, true);
  }

  return error;
}
