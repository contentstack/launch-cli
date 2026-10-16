import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderTable } from '../../../core/render';
import {
  ENVIRONMENT_DETAIL_COLUMNS,
  ENVIRONMENT_VALUE_COLUMN,
  environmentDetailRows,
} from '../../../environments/environment.presenter';

const getInputs = inputs({ org: { required: true }, project: { required: true }, env: { required: true } });

export default class EnvironmentsGet extends LaunchCommand<typeof getInputs> {
  static description = 'Show a single environment of a Launch project';

  static examples = ['$ csdx launch:env:get --org <org-uid> --project <name-or-uid> --env <name-or-uid>'];

  static inputs = getInputs;

  static flags = flagsFor(getInputs);

  async run(): Promise<void> {
    const environment = await this.services.api.environments.get({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
    });

    renderTable(
      this.ux,
      ENVIRONMENT_DETAIL_COLUMNS,
      environmentDetailRows({ ...environment, project: this.resolved.project }),
      process.stdout.columns,
      ENVIRONMENT_VALUE_COLUMN,
      this.services.outputIsTTY,
    );
  }
}
