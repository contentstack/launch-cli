import type { TableColumn } from '../core/render';
import { isAbsent } from '../core/values';
import type { Secret } from './types';

function text(value: string | undefined): string {
  return value === undefined || isAbsent(value) ? '-' : value;
}

export function secretColumns(): TableColumn<Secret>[] {
  return [
    { header: 'KEY', value: (secret) => text(secret.key) },
    { header: 'UPDATED', value: (secret) => text(secret.updatedAt) },
  ];
}
