import { ProjectConfig } from './project-config';
import { InputDependencyError, MissingInputError } from './errors';
import { FlagKey, resolutionTable } from '../resources';
import { AnyInputs, InputKeys, Resolved } from './inputs';
import { AnyResolutionSpec, InputSource, ResolveServices } from './resolution';
import { InputSources, Rule } from './rules';
import { isAbsent } from './values';

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
  projectConfig: ProjectConfig;
  services: ResolveServices;
  rules?: Rule[];
}

export async function resolveInputs<S extends AnyInputs>(spec: S, args: ResolveArgs): Promise<Resolved<S>> {
  const resolved = {} as Resolved<S>;
  const sources: InputSources = {};

  type K = InputKeys<S>;
  const declared = (Object.keys(resolutionTable) as K[]).filter((candidate) => candidate in spec);

  const requireDependencies = (rule: AnyResolutionSpec): void => {
    for (const dependency of rule.dependsOn ?? []) {
      if (isAbsent((resolved as Partial<Record<FlagKey, unknown>>)[dependency])) {
        throw new MissingInputError(dependency);
      }
    }
  };

  for (const key of resolutionOrder(declared)) {
    const rule = resolutionTable[key];
    let value = args.parsed[key];
    let source: InputSource = 'flag';

    if (isAbsent(value) && rule.configPath) {
      value = args.projectConfig[rule.configPath];
      source = 'config';
    }

    if (isAbsent(value) && rule.prompt && args.services.isTTY) {
      requireDependencies(rule);
      value = await rule.prompt({ services: args.services, resolved });
      source = 'prompt';
    }

    if (isAbsent(value) && rule.default !== undefined) {
      value = rule.default;
      source = 'default';
    }

    if (!isAbsent(value) && rule.normalize) {
      requireDependencies(rule);
      value = await rule.normalize(value, { services: args.services, resolved, source });
    }

    if (isAbsent(value)) {
      if (spec[key].required) {
        throw new MissingInputError(key);
      }

      value = undefined;
    } else {
      sources[key] = source;
    }

    resolved[key] = value as Resolved<S>[K];
  }

  for (const rule of args.rules ?? []) {
    rule(resolved, sources);
  }

  return resolved;
}
