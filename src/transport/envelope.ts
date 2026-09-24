import { LaunchApiError } from './errors';

export const MALFORMED_CODE = 'launch.RESPONSE.MALFORMED';

export function malformed(message: string): LaunchApiError {
  return new LaunchApiError(200, [{ code: MALFORMED_CODE, message }]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasUid<T extends { uid?: unknown }>(entity: T): entity is T & { uid: string } {
  return typeof entity.uid === 'string' && entity.uid.trim() !== '';
}

function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

export function unwrap<T>(response: unknown, key: string, subject: string): T {
  if (!isRecord(response) || !isRecord(response[key])) {
    throw malformed(`The Launch API returned ${withArticle(subject)} without ${withArticle(key)}.`);
  }

  return response[key] as T;
}

export function assertArray(response: unknown, key: string, subject: string): void {
  if (!isRecord(response) || !Array.isArray(response[key])) {
    throw malformed(`The Launch API returned ${withArticle(subject)} without ${withArticle(key)} array.`);
  }
}

export function assertPage(response: unknown, key: string, subject: string): void {
  assertArray(response, key, subject);

  if (!isRecord((response as Record<string, unknown>).pagination)) {
    throw malformed(`The Launch API returned ${withArticle(subject)} without a pagination block.`);
  }
}
