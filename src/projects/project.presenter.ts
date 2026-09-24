import type { TableColumn } from '../core/render';
import type { Project, ProjectUpdate } from './types';

export const PROJECT_COLUMNS: TableColumn<Project>[] = [
  { header: 'UID', value: (project) => project.uid ?? '-' },
  { header: 'NAME', value: (project) => project.name ?? '-' },
  { header: 'TYPE', value: (project) => project.projectType ?? '-' },
  { header: 'UPDATED', value: (project) => project.updatedAt ?? '-' },
];

export function projectDetailFields(project: Project): [string, string][] {
  return [
    ['uid', project.uid ?? ''],
    ['name', project.name ?? ''],
    ['description', project.description ?? ''],
    ['type', project.projectType ?? ''],
  ];
}

export function projectDeleteQuestion(project: Project, reference: string): string {
  const named = project.name ? `"${project.name}" (${reference})` : `"${reference}"`;

  return `Delete project ${named}? This cannot be undone.`;
}

export function projectDeletedLine(project: Project, reference: string): string {
  return `\u2714 Project "${project.name || reference}" deleted.`;
}

export interface PartialCreateFailure {
  projectName: string;
  projectUid: string;
  environmentName: string;
  status: string;
  org: string;
  environmentUid?: string;
  deploymentUid?: string;
  reason?: string;
}

export function projectCreatedFields(project: Project, siteUrl?: string): [string, string][] {
  return [
    ['uid', project.uid ?? ''],
    ['name', project.name ?? ''],
    ['type', project.projectType ?? ''],
    ['url', siteUrl ?? ''],
  ];
}

export function deploymentFailureMessage(failure: PartialCreateFailure): string {
  const scope = `--org ${failure.org} --project ${failure.projectUid}`;
  const environment = failure.environmentUid === undefined ? '' : ` --environment ${failure.environmentUid}`;
  const deployment = failure.deploymentUid === undefined ? '' : ` --deployment ${failure.deploymentUid}`;

  const opening =
    failure.reason === undefined
      ? `The deployment did not succeed; its last status was ${failure.status}. `
      : `The deployment could not be followed to completion: ${failure.reason} `;

  return (
    opening +
    `The project "${failure.projectName}" (${failure.projectUid}) and its environment ` +
    `"${failure.environmentName}" were created and have not been rolled back. ` +
    `Run csdx launch:deployments:create ${scope}${environment} to try the deployment again, ` +
    `or csdx launch:logs:get ${scope}${environment}${deployment} to see why it did not succeed.`
  );
}

export const PROJECT_UPDATABLE_FIELDS: (keyof ProjectUpdate)[] = ['name', 'description'];

export function projectUpdatedLines(requested: ProjectUpdate, updated: Project): string[] {
  return PROJECT_UPDATABLE_FIELDS.filter((field) => requested[field] !== undefined).map(
    (field) => `\u2714 ${field} updated to "${updated[field] ?? requested[field]}"`,
  );
}
