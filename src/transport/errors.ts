export interface ApiErrorEntry {
  code: string;
  message: string;
}

export type ErrorMessages = Record<string, string>;

export function messageForCode(messages: ErrorMessages, code?: string): string | undefined {
  return code === undefined ? undefined : messages[code];
}

export class LaunchApiError extends Error {
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
