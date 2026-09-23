import { globalFlags } from './core/catalog';
import { globalResolution, type AnyResolutionSpec } from './core/resolution';
import { PROJECT_DEPENDENCIES, projectFlags, projectResolution } from './projects/project.inputs';
import { ProjectsApi } from './projects/projects.api';
import type { RestApiClient } from './transport/rest-client';

export const catalog = { ...globalFlags, ...projectFlags };

export type Catalog = typeof catalog;
export type FlagKey = keyof Catalog;

export const resolution = { ...globalResolution, ...projectResolution };

export type Resolution = typeof resolution;

export const resolutionTable: Record<FlagKey, AnyResolutionSpec> = resolution;

export const DEPENDENCIES = { ...PROJECT_DEPENDENCIES } satisfies Partial<Record<FlagKey, readonly FlagKey[]>>;

export type DependenciesOf<K extends FlagKey> = K extends keyof typeof DEPENDENCIES
  ? (typeof DEPENDENCIES)[K][number]
  : never;

export interface ApiSurface {
  projects: ProjectsApi;
}

export function buildApi(client: RestApiClient): ApiSurface {
  return { projects: new ProjectsApi(client) };
}
