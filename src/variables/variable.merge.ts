import type { EnvironmentVariableInput } from '../environments/types';

export interface VariableSource {
  label: string;
  variables: EnvironmentVariableInput[];
}

export interface MergedVariables {
  variables: EnvironmentVariableInput[];
  added: { label: string; count: number }[];
  overrides: { label: string; keys: string[] }[];
}

export function mergeSources(sources: VariableSource[]): MergedVariables {
  const held = new Map<string, string>();
  const added: MergedVariables['added'] = [];
  const overrides: MergedVariables['overrides'] = [];

  for (const source of sources) {
    const before = new Set(held.keys());
    const supplied = new Map<string, string>();
    const overridden: string[] = [];

    for (const { key, value } of source.variables) {
      if (before.has(key) && !supplied.has(key)) {
        overridden.push(key);
      }

      supplied.set(key, value);
      held.set(key, value);
    }

    const count = [...supplied.keys()].filter((key) => !before.has(key)).length;

    if (count > 0) {
      added.push({ label: source.label, count });
    }

    if (overridden.length > 0) {
      overrides.push({ label: source.label, keys: overridden });
    }
  }

  return {
    variables: [...held].map(([key, value]) => ({ key, value })),
    added,
    overrides,
  };
}
