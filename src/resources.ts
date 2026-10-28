import { coreFlags } from './core/catalog';
import { coreResolution, type AnyResolutionSpec } from './core/resolution';
import { organizationFlags, organizationResolution } from './organizations/organization.inputs';
import { PROJECT_DEPENDENCIES, projectFlags, projectResolution } from './projects/project.inputs';
import {
  ENVIRONMENT_DEPENDENCIES,
  environmentFlags,
  environmentResolution,
} from './environments/environment.inputs';
import { variableFlags, variableResolution } from './variables/variable.inputs';
import { cacheFlags, cacheResolution } from './cache/cache.inputs';
import { deploymentFlags, deploymentResolution } from './deployments/deployment.inputs';
import { logsFlags, logsResolution } from './logs/logs.inputs';
import { ProjectsApi } from './projects/projects.api';
import { EnvironmentsApi } from './environments/environments.api';
import { DeploymentsApi } from './deployments/deployments.api';
import { DeploymentLogsApi } from './deployments/deployment-logs.api';
import { GitApi } from './git/git.api';
import { OrganizationsApi } from './organizations/organizations.api';
import { UploadsApi } from './uploads/uploads.api';
import { StacksApi } from './stacks/stacks.api';
import { VariablesApi } from './variables/variables.api';
import { CacheApi } from './cache/cache.api';
import type { CmaSession } from './transport/cma-client';
import type { RestApiClient } from './transport/rest-client';

export const catalog = {
  ...organizationFlags,
  ...coreFlags,
  ...projectFlags,
  ...environmentFlags,
  ...variableFlags,
  ...cacheFlags,
  ...deploymentFlags,
  ...logsFlags,
};

export type Catalog = typeof catalog;
export type FlagKey = keyof Catalog;

export const resolution = {
  ...projectResolution,
  ...organizationResolution,
  ...coreResolution,
  ...environmentResolution,
  ...variableResolution,
  ...cacheResolution,
  ...deploymentResolution,
  ...logsResolution,
};

export type Resolution = typeof resolution;

export const resolutionTable: Record<FlagKey, AnyResolutionSpec> = resolution;

export const DEPENDENCIES = { ...PROJECT_DEPENDENCIES, ...ENVIRONMENT_DEPENDENCIES } satisfies Partial<
  Record<FlagKey, readonly FlagKey[]>
>;

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
  uploads: UploadsApi;
  stacks: StacksApi;
  variables: VariablesApi;
  cache: CacheApi;
}

export function buildApi(client: RestApiClient, cma: CmaSession, logsClient: RestApiClient): ApiSurface {
  return {
    organizations: new OrganizationsApi(cma),
    projects: new ProjectsApi(client),
    environments: new EnvironmentsApi(client),
    deployments: new DeploymentsApi(client),
    deploymentLogs: new DeploymentLogsApi(logsClient),
    git: new GitApi(client),
    uploads: new UploadsApi(client),
    stacks: new StacksApi(cma),
    variables: new VariablesApi(client),
    cache: new CacheApi(client),
  };
}
