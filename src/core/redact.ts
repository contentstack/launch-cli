import { TableColumn } from './render';

export const REDACTED = '••••••';

export function redactedColumn<T>(header: string): TableColumn<T> {
  return { header, value: () => REDACTED };
}
