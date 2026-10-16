import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { EXIT_CANCELLED } from '../../../core/constants';
import {
  ENVIRONMENT_DELETE_QUESTION,
  environmentDeletedLine,
  environmentNotDeletedLine,
} from '../../../environments/environment.presenter';

const deleteInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  yes: {},
});

export default class EnvironmentsDelete extends LaunchCommand<typeof deleteInputs> {
  static description = 'Delete an environment of a Launch project';

  static examples = [
    '$ csdx launch:env:delete --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
    '$ csdx launch:env:delete --org <org-uid> --project <name-or-uid> --env <name-or-uid> --yes',
  ];

  static inputs = deleteInputs;

  static flags = flagsFor(deleteInputs);

  async run(): Promise<void> {
    const scope = { org: this.resolved.org, project: this.resolved.project, environment: this.resolved.env };
    const outputIsTTY = this.services.outputIsTTY === true;

    await this.services.api.environments.get(scope);

    if (!(await this.confirm(ENVIRONMENT_DELETE_QUESTION))) {
      this.ux.print(environmentNotDeletedLine(outputIsTTY));
      this.exit(EXIT_CANCELLED);
    }

    await this.services.api.environments.delete(scope);

    this.ux.print(environmentDeletedLine(outputIsTTY));
  }
}
