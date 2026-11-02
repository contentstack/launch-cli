import { randomInt, randomUUID } from 'node:crypto';

export function gluedValue(): string {
  return `${randomInt(10)}${randomUUID()}`;
}
