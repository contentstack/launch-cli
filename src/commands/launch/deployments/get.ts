import { UsageError } from '../../../core/errors';
import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderTable } from '../../../core/render';
import {
  DEPLOYMENT_DETAIL_COLUMNS,
  DEPLOYMENT_VALUE_COLUMN,
  deploymentDetailRows,
} from '../../../deployments/deployment.presenter';
import { fetchDeployment } from '../../../deployments/deployment.resolver';

const getInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  deployment: {},
});

export default class DeploymentsGet extends LaunchCommand<typeof getInputs> {
  static description = 'Show a deployment of a Launch environment, the latest one unless --deployment names another';

  static examples = [
    '$ csdx launch:deployments:get --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
    '$ csdx launch:deployments:get --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--deployment <deployment-uid>',
  ];

  static inputs = getInputs;

  static flags = flagsFor(getInputs);

  async run(): Promise<void> {
    const projectScope = { org: this.resolved.org, project: this.resolved.project };
    const scope = { ...projectScope, environment: this.resolved.env };
    const project = await this.services.api.projects.get(projectScope);
    const requested = this.resolved.deployment;
    const deployment =
      requested === undefined
        ? await this.services.api.deployments.latest(scope)
        : await fetchDeployment(this.services.api.deployments, { ...scope, deployment: requested });

    if (deployment === undefined) {
      throw new UsageError('No deployments found in this environment.');
    }

    renderTable(
      this.ux,
      DEPLOYMENT_DETAIL_COLUMNS,
      deploymentDetailRows(deployment, project.projectType !== 'FILEUPLOAD'),
      process.stdout.columns,
      DEPLOYMENT_VALUE_COLUMN,
      this.services.outputIsTTY,
    );
  }
}
