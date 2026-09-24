import { LaunchApiError } from './errors';

export const MALFORMED_CODE = 'launch.RESPONSE.MALFORMED';

export function malformed(message: string): LaunchApiError {
  return new LaunchApiError(200, [{ code: MALFORMED_CODE, message }]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a';
}

export function unwrap<T>(response: unknown, key: string, subject: string): T {
  if (!isRecord(response) || !isRecord(response[key])) {
    throw malformed(`The Launch API returned ${subject} without ${article(key)} ${key}.`);
  }

  return response[key] as T;
}

export function assertArray(response: unknown, key: string, subject: string): void {
  if (!isRecord(response) || !Array.isArray(response[key])) {
    throw malformed(`The Launch API returned ${subject} without ${article(key)} ${key} array.`);
  }
}

export function assertPage(response: unknown, key: string, subject: string): void {
  assertArray(response, key, subject);

  if (!isRecord((response as Record<string, unknown>).pagination)) {
    throw malformed(`The Launch API returned ${subject} without a pagination block.`);
  }
}
