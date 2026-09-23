import { UsageError } from './errors';
import { FlagKey } from '../resources';

export type ResolvedValues = Record<string, unknown>;

export type Rule = (resolved: ResolvedValues) => void;

export const FRAMEWORK_KEY = 'framework';
export const SERVER_COMMAND_KEY = 'server-cmd';

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

export function dependsOnValue(key: FlagKey, value: unknown, ...dependents: FlagKey[]): Rule {
  return (resolved) => {
    if (resolved[key] === value) {
      return;
    }

    const offending = dependents.filter((dependent) => isSupplied(resolved[dependent]));

    if (offending.length > 0) {
      throw new UsageError(`${list(offending)} requires --${key} ${String(value)}.`);
    }
  };
}

export function requiresFrameworkIn(frameworks: string[]): Rule {
  return (resolved) => {
    if (!isSupplied(resolved[SERVER_COMMAND_KEY])) {
      return;
    }

    const framework = resolved[FRAMEWORK_KEY];

    if (typeof framework !== 'string' || !frameworks.includes(framework)) {
      throw new UsageError(`--${SERVER_COMMAND_KEY} applies only to the ${frameworks.join(', ')} frameworks.`);
    }
  };
}
