import { Project } from '../../../api/types';
import { LaunchCommand } from '../../../base/launch-command';
import { flagsFor, inputs } from '../../../flags/inputs';
import { TableColumn, renderPagination, renderTable } from '../../../output/render';

export const PROJECT_COLUMNS: TableColumn<Project>[] = [
  { header: 'UID', value: (project) => project.uid },
  { header: 'NAME', value: (project) => project.name },
  { header: 'TYPE', value: (project) => project.projectType ?? '-' },
  { header: 'UPDATED', value: (project) => project.updatedAt ?? '-' },
];

export default class ProjectsList extends LaunchCommand<'org' | 'limit' | 'skip'> {
  static description = 'List Launch projects in an organization';

  static examples = ['$ csdx launch:projects:list --org <org-uid>'];

  static inputs = inputs({ org: { required: true }, limit: {}, skip: {} });

  static flags = flagsFor(ProjectsList.inputs);

  async run(): Promise<void> {
    const page = await this.services.api.projects.list({
      org: this.resolved.org as string,
      limit: this.resolved.limit as number,
      skip: this.resolved.skip as number,
    });

    renderTable(this.ux, PROJECT_COLUMNS, page.projects);
    renderPagination(this.ux, page.pagination);
  }
}
