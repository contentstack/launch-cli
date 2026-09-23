import { getByPath } from '../config/project-config';
import { UsageError } from '../errors';
import { PROJECT_CONFIG_FILE } from '../config/constants';
import { FlagKey } from './catalog';
import { InputsSpec } from './inputs';
import { ResolveServices, resolution } from './resolution';
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

export interface ResolveArgs {
  parsed: Partial<Record<FlagKey, unknown>>;
  projectConfig: Record<string, unknown>;
  services: ResolveServices;
  rules?: Rule[];
}

export async function resolveInputs<K extends FlagKey>(
  spec: InputsSpec<K>,
  args: ResolveArgs,
): Promise<Record<K, unknown>> {
  const resolved = {} as Record<K, unknown>;

  for (const key of (Object.keys(resolution) as K[]).filter((candidate) => candidate in spec)) {
    const rule = resolution[key];
    let value = args.parsed[key];

    if (value === undefined && rule.configPath) {
      value = getByPath(args.projectConfig, rule.configPath);
    }

    if (value === undefined && rule.prompt && args.services.isTTY) {
      value = await rule.prompt({ services: args.services, resolved });
    }

    if (value === undefined && rule.default !== undefined) {
      value = rule.default;
    }

    if (value !== undefined && rule.normalize) {
      value = await rule.normalize(value, { services: args.services, resolved });
    }

    if (value === undefined && spec[key].required) {
      throw new MissingInputError(key);
    }

    resolved[key] = value;
  }

  for (const rule of args.rules ?? []) {
    rule(resolved);
  }

  return resolved;
}
