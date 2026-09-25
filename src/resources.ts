import { coreFlags } from './core/catalog';
import { coreResolution, type AnyResolutionSpec } from './core/resolution';
import { organizationFlags, organizationResolution } from './organizations/organization.inputs';
import { PROJECT_DEPENDENCIES, projectFlags, projectResolution } from './projects/project.inputs';
import { environmentFlags, environmentResolution } from './environments/environment.inputs';
import { gitFlags, gitResolution } from './git/git.inputs';
import { ProjectsApi } from './projects/projects.api';
import { EnvironmentsApi } from './environments/environments.api';
import { DeploymentsApi } from './deployments/deployments.api';
import { DeploymentLogsApi } from './deployments/deployment-logs.api';
import { GitApi } from './git/git.api';
import { OrganizationsApi } from './organizations/organizations.api';
import type { CmaSession } from './transport/cma-client';
import type { RestApiClient } from './transport/rest-client';

export const catalog = { ...organizationFlags, ...coreFlags, ...projectFlags, ...environmentFlags, ...gitFlags };

export type Catalog = typeof catalog;
export type FlagKey = keyof Catalog;

export const resolution = {
  ...projectResolution,
  ...organizationResolution,
  ...coreResolution,
  ...environmentResolution,
  ...gitResolution,
};

export type Resolution = typeof resolution;

export const resolutionTable: Record<FlagKey, AnyResolutionSpec> = resolution;

export const DEPENDENCIES = { ...PROJECT_DEPENDENCIES } satisfies Partial<Record<FlagKey, readonly FlagKey[]>>;

export type DependenciesOf<K extends FlagKey> = K extends keyof typeof DEPENDENCIES
  ? (typeof DEPENDENCIES)[K][number]
  : never;

export interface ApiSurface {
  organizations: OrganizationsApi;
  projects: ProjectsApi;
  environments: EnvironmentsApi;
  deployments: DeploymentsApi;
  deploymentLogs: DeploymentLogsApi;
  git: GitApi;
}

export function buildApi(client: RestApiClient, cma: CmaSession, logsClient: RestApiClient): ApiSurface {
  return {
    organizations: new OrganizationsApi(cma),
    projects: new ProjectsApi(client),
    environments: new EnvironmentsApi(client),
    deployments: new DeploymentsApi(client),
    deploymentLogs: new DeploymentLogsApi(logsClient),
    git: new GitApi(client),
  };
}
