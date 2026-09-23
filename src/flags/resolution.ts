import { ApiSurface } from '../api';
import { DEFAULT_LIMIT } from '../config/constants';
import { UxLike } from '../output/render';
import { promptForProject, resolveProjectUid } from '../select/project';
import { FlagKey } from './catalog';

export interface ResolveServices {
  api: ApiSurface;
  ux: UxLike;
  isTTY: boolean;
}

export interface PromptArgs {
  services: ResolveServices;
  resolved: Record<string, unknown>;
}

export const DEPENDENCIES = { project: ['org'] } as const satisfies Partial<Record<FlagKey, readonly FlagKey[]>>;

export type DependenciesOf<K extends FlagKey> = K extends keyof typeof DEPENDENCIES
  ? (typeof DEPENDENCIES)[K][number]
  : never;

export interface ResolutionSpec {
  configPath?: string;
  dependsOn?: readonly FlagKey[];
  prompt?: (args: PromptArgs) => Promise<unknown>;
  normalize?: (value: unknown, args: PromptArgs) => Promise<unknown>;
  default?: unknown;
}

export const resolution: Record<FlagKey, ResolutionSpec> = {
  org: { configPath: 'organizationUid' },
  project: {
    configPath: 'uid',
    dependsOn: DEPENDENCIES.project,
    prompt: ({ services, resolved }) => promptForProject(services, resolved.org as string),
    normalize: (value, { services, resolved }) => resolveProjectUid(services, resolved.org as string, value as string),
  },
  limit: { default: DEFAULT_LIMIT },
  skip: { default: 0 },
  yes: { default: false },
  config: {},
  'data-dir': {},
};
