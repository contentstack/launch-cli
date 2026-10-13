import { isRecord } from '../core/values';
import { LaunchApiError } from './errors';

export const MALFORMED_CODE = 'launch.RESPONSE.MALFORMED';

export function malformed(message: string): LaunchApiError {
  return new LaunchApiError(200, [{ code: MALFORMED_CODE, message }]);
}

export function hasUid<T extends { uid?: unknown }>(entity: T): entity is T & { uid: string } {
  return typeof entity.uid === 'string' && entity.uid.trim() !== '';
}

function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

export function unwrap<T>(response: unknown, member: string, subject: string): T {
  if (!isRecord(response) || !isRecord(response[member])) {
    throw malformed(`The Launch API returned ${withArticle(subject)} without ${withArticle(member)}.`);
  }

  return response[member] as T;
}

export function assertArray(response: unknown, member: string, subject: string): void {
  if (!isRecord(response) || !Array.isArray(response[member])) {
    throw malformed(`The Launch API returned ${withArticle(subject)} without ${withArticle(member)} array.`);
  }
}

export function assertPage(response: unknown, member: string, subject: string): void {
  assertArray(response, member, subject);

  if (!isRecord((response as Record<string, unknown>).pagination)) {
    throw malformed(`The Launch API returned ${withArticle(subject)} without a pagination block.`);
  }
}
