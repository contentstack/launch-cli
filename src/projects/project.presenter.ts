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

export function projectDeleteQuestion(reference: string): string {
  return `Delete project "${reference}"? This cannot be undone.`;
}

export function projectDeletedLine(project: Project, reference: string): string {
  return `\u2714 Project "${project.name || reference}" deleted.`;
}

export const PROJECT_UPDATABLE_FIELDS: (keyof ProjectUpdate)[] = ['name', 'description'];

export function projectUpdatedLines(requested: ProjectUpdate, updated: Project): string[] {
  return PROJECT_UPDATABLE_FIELDS.filter((field) => requested[field] !== undefined).map(
    (field) => `\u2714 ${field} updated to "${updated[field] ?? requested[field]}"`,
  );
}
