import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderPagination, renderTable } from '../../../core/render';
import { PROJECT_COLUMNS } from '../../../projects/project.presenter';

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
    renderPagination(this.ux, page.pagination, page.projects.length);
  }
}
