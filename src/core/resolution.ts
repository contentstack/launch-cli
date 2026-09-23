import type { ApiSurface, Catalog, FlagKey } from '../resources';
import { DEFAULT_LIMIT } from './constants';
import type { ValueOf } from './inputs';
import type { ProjectConfigKey } from './project-config';
import type { UxLike } from './render';

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

export interface ResolutionSpec<T, D extends FlagKey = never> {
  configPath?: ProjectConfigKey;
  dependsOn?: readonly D[];
  prompt?(args: PromptArgs<D>): Promise<T>;
  normalize?(value: T, args: PromptArgs<D>): Promise<T>;
  default?: T;
}

export interface AnyResolutionSpec {
  configPath?: ProjectConfigKey;
  dependsOn?: readonly FlagKey[];
  prompt?(args: LooseArgs): Promise<unknown>;
  normalize?(value: unknown, args: LooseArgs): Promise<unknown>;
  default?: unknown;
}

export const globalResolution = {
  org: { configPath: 'organizationUid' } satisfies ResolutionSpec<string>,
  limit: { default: DEFAULT_LIMIT } satisfies ResolutionSpec<number>,
  skip: { default: 0 } satisfies ResolutionSpec<number>,
  yes: { default: false } satisfies ResolutionSpec<boolean>,
  config: {} satisfies ResolutionSpec<string>,
  'data-dir': {} satisfies ResolutionSpec<string>,
};
