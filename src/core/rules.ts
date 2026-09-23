import { UsageError } from './errors';
import { FlagKey } from '../resources';

export type ResolvedValues = Record<string, unknown>;

export type Rule = (resolved: ResolvedValues) => void;

function isSupplied(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

function list(keys: string[]): string {
  return keys.map((key) => `--${key}`).join(', ');
}

export function exactlyOneOf(...keys: FlagKey[]): Rule {
  return (resolved) => {
    const supplied = keys.filter((key) => isSupplied(resolved[key]));

    if (supplied.length === 1) {
      return;
    }

    const detail = supplied.length === 0 ? 'none was supplied.' : `${list(supplied)} were supplied.`;
    throw new UsageError(`Pass exactly one of ${list(keys)}; ${detail}`);
  };
}

export function atLeastOneOf(...keys: FlagKey[]): Rule {
  return (resolved) => {
    if (keys.some((key) => isSupplied(resolved[key]))) {
      return;
    }

    throw new UsageError(`Pass at least one of ${list(keys)}; none was supplied.`);
  };
}
