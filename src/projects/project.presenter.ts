import type { TableColumn } from '../core/render';
import type { Project } from './types';

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
