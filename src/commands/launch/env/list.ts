import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderPagination, renderTable } from '../../../core/render';
import { environmentColumns } from '../../../environments/environment.presenter';

const listInputs = inputs({ org: { required: true }, project: { required: true }, limit: {}, skip: {} });

export default class EnvironmentsList extends LaunchCommand<typeof listInputs> {
  static description = 'List the environments of a Launch project';

  static examples = ['$ csdx launch:env:list --org <org-uid> --project <name-or-uid>'];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const scope = { org: this.resolved.org, project: this.resolved.project };
    const [page, project] = await Promise.all([
      this.services.api.environments.list({ ...scope, limit: this.resolved.limit, skip: this.resolved.skip }),
      this.services.api.projects.get(scope),
    ]);

    renderTable(
      this.ux,
      environmentColumns(project.projectType !== 'FILEUPLOAD'),
      page.environments,
      process.stdout.columns,
      undefined,
      this.services.outputIsTTY,
    );
    renderPagination(this.ux, { ...page.pagination, skip: this.resolved.skip }, page.environments.length);
  }
}
