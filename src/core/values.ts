import { UsageError } from './errors';

export function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  return typeof value === 'string' && value.trim() === '';
}

export async function withinLength(flag: string, value: string, max: number): Promise<string> {
  if (value.length > max) {
    throw new UsageError(`--${flag} must be ${max} characters or fewer; that value is ${value.length} characters.`);
  }

  return value;
}

export function oneOf<T extends string>(flag: string, value: string, allowed: readonly T[]): T {
  const wanted = value.trim().toLowerCase();
  const match = allowed.find((option) => option.toLowerCase() === wanted);

  if (match === undefined) {
    throw new UsageError(`--${flag} must be one of ${allowed.join(', ')}; "${value}" is not.`);
  }

  return match;
}
