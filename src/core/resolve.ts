import type { ProjectConfig } from './project-config';
import { InputDependencyError, MissingInputError } from './errors';
import type { FlagKey } from '../resources';
import { resolutionTable } from '../resources';
import type { AnyInputs, InputKeys, Resolved } from './inputs';
import type { AnyResolutionSpec, InputSource, ResolveServices } from './resolution';
import type { InputSources, Rule } from './rules';
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

function missing(key: FlagKey): MissingInputError {
  const rule = resolutionTable[key];

  return new MissingInputError(key, { config: rule.configPath !== undefined, prompt: rule.prompt !== undefined });
}

export interface ResolveArgs {
  parsed: Partial<Record<FlagKey, unknown>>;
  projectConfig: ProjectConfig | (() => ProjectConfig);
  services: ResolveServices;
  rules?: Rule[];
}

export interface TracedResolution<S extends AnyInputs> {
  resolved: Resolved<S>;
  sources: InputSources;
}

export async function resolveInputs<S extends AnyInputs>(spec: S, args: ResolveArgs): Promise<Resolved<S>> {
  return (await resolveInputsTraced(spec, args)).resolved;
}

export async function resolveInputsTraced<S extends AnyInputs>(
  spec: S,
  args: ResolveArgs,
): Promise<TracedResolution<S>> {
  const resolved = {} as Resolved<S>;
  const sources: InputSources = {};
  const readConfig = (): ProjectConfig =>
    typeof args.projectConfig === 'function' ? args.projectConfig() : args.projectConfig;

  type K = InputKeys<S>;
  const declared = (Object.keys(resolutionTable) as K[]).filter((candidate) => candidate in spec);

  const requireDependencies = (rule: AnyResolutionSpec): void => {
    for (const dependency of rule.dependsOn ?? []) {
      if (isAbsent((resolved as Partial<Record<FlagKey, unknown>>)[dependency])) {
        throw missing(dependency);
      }
    }
  };

  for (const key of resolutionOrder(declared)) {
    const rule = resolutionTable[key];
    let value = args.parsed[key];
    let source: InputSource = 'flag';

    if (isAbsent(value) && rule.configPath) {
      value = readConfig()[rule.configPath];
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
        throw missing(key);
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

  return { resolved, sources };
}
