import { getByPath } from './project-config';
import { UsageError } from './errors';
import { PROJECT_CONFIG_FILE } from './constants';
import { FlagKey, resolutionTable } from '../resources';
import { AnyInputs, InputKeys, Resolved } from './inputs';
import { ResolveServices } from './resolution';
import { Rule } from './rules';

export class MissingInputError extends UsageError {
  readonly flag: string;

  constructor(flag: string) {
    super(
      `Missing required value for --${flag}. Pass --${flag}, set it in ${PROJECT_CONFIG_FILE}, ` +
        'or run in an interactive terminal.',
    );
    this.name = 'MissingInputError';
    this.flag = flag;
  }
}

export class InputDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputDependencyError';
  }
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

export function resolutionOrder<K extends FlagKey>(keys: K[]): K[] {
  const ordered: K[] = [];
  const settled = new Map<K, boolean>();

  const visit = (key: K, trail: K[]): void => {
    const state = settled.get(key);

    if (state === true) {
      return;
    }

    if (state === false) {
      throw new InputDependencyError(
        `${[...trail, key].map((step) => `--${step}`).join(' -> ')} is a dependency cycle.`,
      );
    }

    settled.set(key, false);

    for (const dependency of resolutionTable[key].dependsOn ?? []) {
      if (!keys.includes(dependency as K)) {
        throw new InputDependencyError(
          `--${key} cannot be resolved without --${dependency}: declare ${dependency} in the command inputs.`,
        );
      }

      visit(dependency as K, [...trail, key]);
    }

    settled.set(key, true);
    ordered.push(key);
  };

  for (const key of keys) {
    visit(key, []);
  }

  return ordered;
}

export interface ResolveArgs {
  parsed: Partial<Record<FlagKey, unknown>>;
  projectConfig: Record<string, unknown>;
  services: ResolveServices;
  rules?: Rule[];
}

export async function resolveInputs<S extends AnyInputs>(spec: S, args: ResolveArgs): Promise<Resolved<S>> {
  const resolved = {} as Resolved<S>;

  type K = InputKeys<S>;
  const declared = (Object.keys(resolutionTable) as K[]).filter((candidate) => candidate in spec);

  for (const key of resolutionOrder(declared)) {
    const rule = resolutionTable[key];
    let value = args.parsed[key];

    if (isAbsent(value) && rule.configPath) {
      value = getByPath(args.projectConfig, rule.configPath);
    }

    if (isAbsent(value) && rule.prompt && args.services.isTTY) {
      value = await rule.prompt({ services: args.services, resolved });
    }

    if (isAbsent(value) && rule.default !== undefined) {
      value = rule.default;
    }

    if (!isAbsent(value) && rule.normalize) {
      value = await rule.normalize(value, { services: args.services, resolved });
    }

    if (isAbsent(value)) {
      if (spec[key].required) {
        throw new MissingInputError(key);
      }

      value = undefined;
    }

    resolved[key] = value as Resolved<S>[K];
  }

  for (const rule of args.rules ?? []) {
    rule(resolved);
  }

  return resolved;
}
