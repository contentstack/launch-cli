import type { TableColumn } from '../core/render';
import { styled } from '../core/style';
import { firstDeploymentFailureMessage } from '../deployments/deployment.presenter';
import { isAbsent } from '../core/values';
import type { Environment } from './types';

export interface DetailRow {
  field: string;
  value: string;
}

function text(value: string | undefined): string {
  return value === undefined || isAbsent(value) ? '-' : value;
}

function toggle(value: boolean | undefined): string {
  if (value === undefined) {
    return '-';
  }

  return value ? 'enabled' : 'disabled';
}

function urlsOf(environment: Environment): string[] {
  return (environment.domains ?? [])
    .map((domain) => domain.url)
    .filter((url): url is string => !isAbsent(url));
}

export const ENVIRONMENT_COLUMNS: TableColumn<Environment>[] = [
  { header: 'NAME', value: (environment) => text(environment.name) },
  { header: 'BRANCH', value: (environment) => text(environment.gitBranch) },
  { header: 'URL', value: (environment) => text(urlsOf(environment)[0]) },
  { header: 'UPDATED', value: (environment) => text(environment.updatedAt) },
  { header: 'ENVIRONMENT UID', value: (environment) => text(environment.uid) },
];

export function environmentColumns(showBranch: boolean): TableColumn<Environment>[] {
  return showBranch ? ENVIRONMENT_COLUMNS : ENVIRONMENT_COLUMNS.filter((column) => column.header !== 'BRANCH');
}

export const ENVIRONMENT_DETAIL_COLUMNS: TableColumn<DetailRow>[] = [
  { header: 'FIELD', value: (row) => row.field },
  { header: 'VALUE', value: (row) => row.value },
];

export const ENVIRONMENT_VALUE_COLUMN = 1;

export function environmentDetailRows(environment: Environment, showBranch = true): DetailRow[] {
  const rows: DetailRow[] = [
    { field: 'ENVIRONMENT UID', value: text(environment.uid) },
    { field: 'NAME', value: text(environment.name) },
    { field: 'DESCRIPTION', value: text(environment.description) },
    { field: 'BRANCH', value: text(environment.gitBranch) },
    { field: 'FRAMEWORK', value: text(environment.frameworkPreset) },
    { field: 'BUILD COMMAND', value: text(environment.buildCommand) },
    { field: 'OUTPUT DIRECTORY', value: text(environment.outputDirectory) },
    { field: 'SERVER COMMAND', value: text(environment.serverCommand) },
    { field: 'AUTO DEPLOY', value: toggle(environment.autoDeployOnPush) },
    { field: 'VARIABLES', value: String(environment.environmentVariables?.length ?? 0) },
    { field: 'CACHE PRIMING', value: toggle(environment.isCachePrimingEnabled) },
    { field: 'CONTENTSTACK AUTHENTICATION', value: toggle(environment.isContentstackAuthenticationEnabled) },
    { field: 'PASSWORD PROTECTION', value: toggle(environment.passwordProtection?.isEnabled) },
    { field: 'URL', value: text(urlsOf(environment).join(', ')) },
    { field: 'ORGANIZATION UID', value: text(environment.organizationUid) },
    { field: 'PROJECT UID', value: text(environment.project) },
    { field: 'CREATED AT', value: text(environment.createdAt) },
    { field: 'UPDATED AT', value: text(environment.updatedAt) },
  ];

  return showBranch ? rows : rows.filter((row) => row.field !== 'BRANCH');
}

export const ENVIRONMENT_DELETE_QUESTION = 'Are you sure you want to delete this environment?';

export function environmentDeletedLine(outputIsTTY: boolean): string {
  return styled('\u2714 Environment deleted successfully.', 'green', outputIsTTY);
}

export function environmentNotDeletedLine(outputIsTTY: boolean): string {
  return styled('Environment not deleted.', 'yellow', outputIsTTY);
}

export function environmentUpdatedLine(outputIsTTY: boolean): string {
  return styled('\u2714 Environment updated successfully.', 'green', outputIsTTY);
}

export function environmentNotUpdatedLine(outputIsTTY: boolean): string {
  return styled('Environment not updated.', 'yellow', outputIsTTY);
}

export function disableQuestion(feature: string): string {
  return `Are you sure you want to disable ${feature} for this environment?`;
}

export function environmentCreatedLine(outputIsTTY: boolean): string {
  return styled('\u2714 Environment created successfully.', 'green', outputIsTTY);
}

export interface EnvironmentDeploymentFailure {
  org: string;
  project: string;
  environmentName: string;
  environmentUid: string;
  status: string;
  deploymentUid?: string;
  reason?: string;
  timedOut?: boolean;
}

export function environmentDeploymentFailureMessage(failure: EnvironmentDeploymentFailure): string {
  return firstDeploymentFailureMessage({
    created: `The environment "${failure.environmentName}" (${failure.environmentUid})`,
    plural: false,
    org: failure.org,
    project: failure.project,
    environmentUid: failure.environmentUid,
    deploymentUid: failure.deploymentUid,
    status: failure.status,
    reason: failure.reason,
    timedOut: failure.timedOut,
  });
}

export function environmentNoChangesLine(outputIsTTY: boolean): string {
  return styled('Environment not updated. No changes were entered.', 'yellow', outputIsTTY);
}
