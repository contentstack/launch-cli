import { redactedColumn } from '../core/redact';
import type { TableColumn } from '../core/render';
import { isAbsent } from '../core/values';
import type { EnvironmentVariable } from '../environments/types';

function text(value: string | undefined): string {
  return value === undefined || isAbsent(value) ? '-' : value;
}

export function pairColumns(): TableColumn<EnvironmentVariable>[] {
  return [{ header: 'KEY', value: (variable) => text(variable.key) }, redactedColumn('VALUE')];
}

export function variableColumns(updatedAt?: string): TableColumn<EnvironmentVariable>[] {
  return [...pairColumns(), { header: 'UPDATED', value: () => text(updatedAt) }];
}
