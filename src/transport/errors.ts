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

export class LaunchNetworkError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'LaunchNetworkError';
    this.cause = cause;
  }
}

function looksLikeProxyFailure(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };

  if (typeof code === 'string' && PROXY_ERROR_CODES.includes(code)) {
    return true;
  }

  return typeof message === 'string' && message.includes('ERR_BAD_RESPONSE');
}

export function diagnoseTransportError(error: unknown): unknown {
  if (!looksLikeProxyFailure(error)) {
    return error;
  }

  const url = proxyUrl();

  if (url === undefined) {
    return error;
  }

  return new LaunchNetworkError(
    `Proxy error: Unable to connect to proxy server at ${url}. Please verify your proxy configuration.`,
    error,
  );
}
