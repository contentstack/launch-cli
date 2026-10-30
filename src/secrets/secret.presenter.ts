import type { TableColumn } from '../core/render';
import { isAbsent } from '../core/values';
import type { SecretSummary } from './types';

export const EMPTY_SECRETS_MESSAGE = 'No secrets found in this environment.';

function text(value: string | undefined): string {
  return value === undefined || isAbsent(value) ? '-' : value;
}

export function secretColumns(): TableColumn<SecretSummary>[] {
  return [
    { header: 'KEY', value: (secret) => text(secret.key) },
    { header: 'UPDATED', value: (secret) => text(secret.updatedAt) },
  ];
}
