import type { ApiSurface } from '../api';
import { DEFAULT_LIMIT } from '../config/constants';
import type { UxLike } from '../output/render';
import { promptForProject, resolveProjectUid } from '../select/project';
import type { Catalog, FlagKey } from './catalog';
import type { ValueOf } from './inputs';

export interface ResolveServices {
  api: ApiSurface;
  ux: UxLike;
  isTTY: boolean;
}

export interface PromptArgs<D extends FlagKey = never> {
  services: ResolveServices;
  resolved: { [P in D]: ValueOf<Catalog[P]> };
}

export interface LooseArgs {
  services: ResolveServices;
  resolved: Partial<Record<FlagKey, unknown>>;
}

export const DEPENDENCIES = { project: ['org'] } as const satisfies Partial<Record<FlagKey, readonly FlagKey[]>>;

export type DependenciesOf<K extends FlagKey> = K extends keyof typeof DEPENDENCIES
  ? (typeof DEPENDENCIES)[K][number]
  : never;

export interface ResolutionSpec<T, D extends FlagKey = never> {
  configPath?: string;
  dependsOn?: readonly D[];
  prompt?(args: PromptArgs<D>): Promise<T>;
  normalize?(value: T, args: PromptArgs<D>): Promise<T>;
  default?: T;
}

export interface AnyResolutionSpec {
  configPath?: string;
  dependsOn?: readonly FlagKey[];
  prompt?(args: LooseArgs): Promise<unknown>;
  normalize?(value: unknown, args: LooseArgs): Promise<unknown>;
  default?: unknown;
}

export const resolution = {
  org: { configPath: 'organizationUid' } satisfies ResolutionSpec<string>,
  project: {
    configPath: 'uid',
    dependsOn: DEPENDENCIES.project,
    prompt: ({ services, resolved }) => promptForProject(services, resolved.org),
    normalize: (value, { services, resolved }) => resolveProjectUid(services, resolved.org, value),
  } satisfies ResolutionSpec<string, 'org'>,
  limit: { default: DEFAULT_LIMIT } satisfies ResolutionSpec<number>,
  skip: { default: 0 } satisfies ResolutionSpec<number>,
  yes: { default: false } satisfies ResolutionSpec<boolean>,
  config: {} satisfies ResolutionSpec<string>,
  'data-dir': {} satisfies ResolutionSpec<string>,
} satisfies Record<FlagKey, AnyResolutionSpec>;

export type Resolution = typeof resolution;

export const resolutionTable: Record<FlagKey, AnyResolutionSpec> = resolution;
