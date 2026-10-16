import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderPagination, renderTable } from '../../../core/render';
import { ENVIRONMENT_COLUMNS } from '../../../environments/environment.presenter';

const listInputs = inputs({ org: { required: true }, project: { required: true }, limit: {}, skip: {} });

export default class EnvironmentsList extends LaunchCommand<typeof listInputs> {
  static description = 'List the environments of a Launch project';

  static examples = ['$ csdx launch:env:list --org <org-uid> --project <name-or-uid>'];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const page = await this.services.api.environments.list({
      org: this.resolved.org,
      project: this.resolved.project,
      limit: this.resolved.limit,
      skip: this.resolved.skip,
    });

    renderTable(
      this.ux,
      ENVIRONMENT_COLUMNS,
      page.environments,
      process.stdout.columns,
      undefined,
      this.services.outputIsTTY,
    );
    renderPagination(this.ux, { ...page.pagination, skip: this.resolved.skip }, page.environments.length);
  }
}
