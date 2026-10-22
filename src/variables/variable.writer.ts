import type { EnvironmentParams } from '../environments/environments.api';
import type { Environment, EnvironmentVariableInput } from '../environments/types';
import type { PatchVariablesParams } from './variables.api';

export interface VariableStore {
  patch(params: PatchVariablesParams): Promise<void>;
}

export function missingKeys(environment: Environment, keys: string[]): string[] {
  const heldKeys = new Set((environment.environmentVariables ?? []).map(({ key }) => key));

  return [...new Set(keys)].filter((key) => !heldKeys.has(key));
}

export async function setVariables(
  store: VariableStore,
  params: EnvironmentParams,
  incoming: EnvironmentVariableInput[],
): Promise<void> {
  if (incoming.length > 0) {
    await store.patch({ ...params, set: incoming });
  }
}

export async function unsetVariables(
  store: VariableStore,
  params: EnvironmentParams,
  keys: string[],
): Promise<string[]> {
  const wanted = [...new Set(keys)];

  if (wanted.length > 0) {
    await store.patch({ ...params, unset: wanted });
  }

  return wanted;
}
