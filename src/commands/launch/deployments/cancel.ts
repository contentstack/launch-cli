import { EXIT_CANCELLED } from '../../../core/constants';
import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import {
  deploymentCancelQuestion,
  deploymentCancelledLine,
  deploymentNotCancelledLine,
} from '../../../deployments/deployment.presenter';
import { IN_FLIGHT_DEPLOYMENTS } from '../../../deployments/deployment.prompt';
import { fetchDeployment } from '../../../deployments/deployment.resolver';

const cancelInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  deployment: { required: true, picker: IN_FLIGHT_DEPLOYMENTS },
  yes: {},
});

export default class DeploymentsCancel extends LaunchCommand<typeof cancelInputs> {
  static description = 'Cancel a deployment of a Launch environment that is still in progress';

  static examples = [
    '$ csdx launch:deployments:cancel --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--deployment <deployment-uid>',
    '$ csdx launch:deployments:cancel --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--deployment <deployment-uid> --yes',
  ];

  static inputs = cancelInputs;

  static flags = flagsFor(cancelInputs);

  async run(): Promise<void> {
    const { org, project, env: environment, deployment } = this.resolved;
    const scope = { org, project, environment, deployment };
    const outputIsTTY = this.services.outputIsTTY === true;

    await fetchDeployment(this.services.api.deployments, scope);

    if (!(await this.confirm(deploymentCancelQuestion(deployment)))) {
      this.ux.print(deploymentNotCancelledLine(outputIsTTY));
      this.exit(EXIT_CANCELLED);
    }

    await this.services.api.deployments.cancel(scope);

    this.ux.print(deploymentCancelledLine(deployment, outputIsTTY));
  }
}
