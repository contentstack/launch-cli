export interface ApiErrorEntry {
  code: string;
  message: string;
}

const MESSAGES: Record<string, string> = {
  'launch.PROJECT.DUPLICATE_NAME': 'A project with that name already exists in this organization.',
  'launch.PROJECT.LIMIT_REACHED': 'This organization has reached its project limit.',
  'launch.PROJECT.NOT_FOUND': 'No project found with that name or UID.',
};

export function messageForCode(code?: string): string | undefined {
  return code === undefined ? undefined : MESSAGES[code];
}

export class LaunchApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: ApiErrorEntry[];

  constructor(status: number, errors: ApiErrorEntry[]) {
    const primary = errors[0];
    super(
      messageForCode(primary?.code) ?? primary?.message ?? `Launch API request failed with status ${status}.`,
    );
    this.name = 'LaunchApiError';
    this.status = status;
    this.code = primary?.code ?? 'launch.UNKNOWN';
    this.errors = errors;
  }
}

export function parseErrorEnvelope(status: number, body: unknown): LaunchApiError {
  const errors = (body as { errors?: unknown })?.errors;
  return new LaunchApiError(status, Array.isArray(errors) ? (errors as ApiErrorEntry[]) : []);
}
