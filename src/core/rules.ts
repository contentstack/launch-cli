import { UsageError } from './errors';
import type { InputSource } from './resolution';
import { isAbsent } from './values';
import { FlagKey } from '../resources';

export type ResolvedValues = Record<string, unknown>;

export type InputSources = Partial<Record<string, InputSource>>;

export type Rule = (resolved: ResolvedValues, sources: InputSources) => void;

function isSupplied(value: unknown, source: InputSource | undefined): boolean {
  return source !== undefined && source !== 'default' && !isAbsent(value) && value !== false;
}

function list(keys: string[]): string {
  return keys.map((key) => `--${key}`).join(', ');
}

export function exactlyOneOf(...keys: FlagKey[]): Rule {
  return (resolved, sources) => {
    const supplied = keys.filter((key) => isSupplied(resolved[key], sources[key]));

    if (supplied.length === 1) {
      return;
    }

    const detail = supplied.length === 0 ? 'none was supplied.' : `${list(supplied)} were supplied.`;
    throw new UsageError(`Pass exactly one of ${list(keys)}; ${detail}`);
  };
}

export function requireValueOf(flag: string, gate: string, allowed: readonly string[], value: string): void {
  if (!allowed.includes(value)) {
    throw new UsageError(
      `--${flag} is only supported when --${gate} is one of ${allowed.join(', ')}; --${gate} is ${value}.`,
    );
  }
}

export function onlyWithValueOf(flag: FlagKey, gate: FlagKey, allowed: readonly string[]): Rule {
  return (resolved, sources) => {
    if (!isSupplied(resolved[flag], sources[flag])) {
      return;
    }

    const value = resolved[gate];

    if (typeof value !== 'string' || !isSupplied(value, sources[gate])) {
      return;
    }

    requireValueOf(flag, gate, allowed, value);
  };
}

export function atLeastOneOf(...keys: FlagKey[]): Rule {
  return (resolved, sources) => {
    if (keys.some((key) => isSupplied(resolved[key], sources[key]))) {
      return;
    }

    throw new UsageError(`Pass at least one of ${list(keys)}; none was supplied.`);
  };
}
