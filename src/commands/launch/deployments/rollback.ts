import { EXIT_CANCELLED } from '../../../core/constants';
import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import {
  deploymentNotRolledBackLine,
  deploymentRollbackQuestion,
  rolledBackLine,
} from '../../../deployments/deployment.presenter';
import { ALL_DEPLOYMENTS } from '../../../deployments/deployment.prompt';
import { fetchDeployment } from '../../../deployments/deployment.resolver';
import { DeploymentRollback } from '../../../deployments/deployment.rollback';
import { defaultWatchTiming } from '../../../deployments/deployment.watcher';

const rollbackInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  deployment: { required: true, picker: ALL_DEPLOYMENTS },
  reason: {},
  yes: {},
});

export default class DeploymentsRollback extends LaunchCommand<typeof rollbackInputs> {
  static description = 'Roll a Launch environment back to a previous deployment';

  static examples = [
    '$ csdx launch:deployments:rollback --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--deployment <deployment-uid>',
    '$ csdx launch:deployments:rollback --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--deployment <deployment-uid> --reason "bad release" --yes',
  ];

  static inputs = rollbackInputs;

  static flags = flagsFor(rollbackInputs);

  async run(): Promise<void> {
    const { org, project, env: environment, deployment, reason } = this.resolved;
    const scope = { org, project, environment };
    const outputIsTTY = this.services.outputIsTTY === true;

    await fetchDeployment(this.services.api.deployments, { ...scope, deployment });

    if (!(await this.confirm(deploymentRollbackQuestion(deployment)))) {
      this.ux.print(deploymentNotRolledBackLine(outputIsTTY));
      this.exit(EXIT_CANCELLED);
    }

    await new DeploymentRollback(this.services, defaultWatchTiming()).rollback({ ...scope, deployment, reason });

    this.ux.print(rolledBackLine(deployment, outputIsTTY));
  }
}
