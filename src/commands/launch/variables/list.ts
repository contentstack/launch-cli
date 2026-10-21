import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderPagination, renderTable } from '../../../core/render';
import { pageOfVariables } from '../../../variables/variable.page';
import { variableColumns } from '../../../variables/variable.presenter';

const listInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  limit: {},
  skip: {},
});

export default class VariablesList extends LaunchCommand<typeof listInputs> {
  static description = 'List the environment variables of an environment, with their values masked';

  static examples = [
    '$ csdx launch:variables:list --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
  ];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const environment = await this.services.api.environments.get({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
    });
    const page = pageOfVariables(environment.environmentVariables ?? [], this.resolved.limit, this.resolved.skip);

    renderTable(
      this.ux,
      variableColumns(environment.updatedAt),
      page.variables,
      process.stdout.columns,
      undefined,
      this.services.outputIsTTY,
    );
    renderPagination(this.ux, page.pagination, page.variables.length);
  }
}
