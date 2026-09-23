import { Project } from '../../../api/types';
import { LaunchCommand } from '../../../base/launch-command';
import { flagsFor, inputs } from '../../../flags/inputs';
import { TableColumn, renderPagination, renderTable } from '../../../output/render';

export const PROJECT_COLUMNS: TableColumn<Project>[] = [
  { header: 'UID', value: (project) => project.uid ?? '-' },
  { header: 'NAME', value: (project) => project.name ?? '-' },
  { header: 'TYPE', value: (project) => project.projectType ?? '-' },
  { header: 'UPDATED', value: (project) => project.updatedAt ?? '-' },
];

const listInputs = inputs({ org: { required: true }, limit: {}, skip: {} });

export default class ProjectsList extends LaunchCommand<typeof listInputs> {
  static description = 'List Launch projects in an organization';

  static examples = ['$ csdx launch:projects:list --org <org-uid>'];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const page = await this.services.api.projects.list({
      org: this.resolved.org,
      limit: this.resolved.limit,
      skip: this.resolved.skip,
    });

    renderTable(this.ux, PROJECT_COLUMNS, page.projects);
    renderPagination(this.ux, page.pagination);
  }
}
