import { EXIT_RUNTIME } from '../core/constants';
import { LaunchError, UsageError } from '../core/errors';
import type { EnvironmentParams } from '../environments/environments.api';
import type {
  Environment,
  EnvironmentUpdate,
  EnvironmentVariable,
  EnvironmentVariableInput,
} from '../environments/types';

export interface VariableStore {
  get(params: EnvironmentParams): Promise<Environment>;
  update(params: EnvironmentParams & { update: EnvironmentUpdate }): Promise<Environment>;
}

function writable(variable: EnvironmentVariable): variable is EnvironmentVariableInput {
  return (
    typeof variable.key === 'string' &&
    variable.key !== '' &&
    typeof variable.value === 'string' &&
    variable.value !== ''
  );
}

export class UnreadableVariablesError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor(keys: string[]) {
    const named = keys.length > 0 ? ` (${keys.join(', ')})` : '';

    super(
      `This environment holds variables the API returned without a value${named}. ` +
        'Updating the list would delete them, so nothing was changed.',
    );
    this.name = 'UnreadableVariablesError';
  }
}

function stored(environment: Environment): EnvironmentVariable[] {
  return environment.environmentVariables ?? [];
}

function heldBy(environment: Environment): EnvironmentVariableInput[] {
  return stored(environment).filter(writable);
}

export function assertPreservable(environment: Environment): void {
  const lost = stored(environment).filter((variable) => !writable(variable));

  if (lost.length > 0) {
    throw new UnreadableVariablesError(
      lost.flatMap(({ key }) => (typeof key === 'string' && key !== '' ? [key] : [])),
    );
  }
}

export function missingKeys(environment: Environment, keys: string[]): string[] {
  const heldKeys = new Set(heldBy(environment).map(({ key }) => key));

  return [...new Set(keys)].filter((key) => !heldKeys.has(key));
}

export function notSetError(missing: string[]): UsageError {
  return new UsageError(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in this environment.`);
}

export async function setVariables(
  store: VariableStore,
  params: EnvironmentParams,
  incoming: EnvironmentVariableInput[],
): Promise<Environment | undefined> {
  if (incoming.length === 0) {
    return undefined;
  }

  const environment = await store.get(params);

  assertPreservable(environment);

  const merged = new Map(heldBy(environment).map(({ key, value }) => [key, value]));

  incoming.forEach(({ key, value }) => merged.set(key, value));

  return store.update({
    ...params,
    update: { environmentVariables: [...merged].map(([key, value]) => ({ key, value })) },
  });
}

export async function unsetVariables(
  store: VariableStore,
  params: EnvironmentParams,
  keys: string[],
): Promise<string[]> {
  const wanted = [...new Set(keys)];

  if (wanted.length === 0) {
    return [];
  }

  const environment = await store.get(params);
  const missing = missingKeys(environment, wanted);

  if (missing.length > 0) {
    throw notSetError(missing);
  }

  assertPreservable(environment);

  const held = heldBy(environment);

  await store.update({
    ...params,
    update: { environmentVariables: held.filter(({ key }) => !wanted.includes(key)) },
  });

  return wanted;
}
