import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderPagination, renderTable } from '../../../core/render';
import { deploymentColumns } from '../../../deployments/deployment.presenter';
import { hasUid } from '../../../transport/envelope';

const listInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  limit: {},
  skip: {},
});

export default class DeploymentsList extends LaunchCommand<typeof listInputs> {
  static description = 'List the deployments of a Launch environment';

  static examples = [
    '$ csdx launch:deployments:list --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
  ];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const scope = { org: this.resolved.org, project: this.resolved.project };
    const project = await this.services.api.projects.get(scope);
    const page = await this.services.api.deployments.list({
      ...scope,
      environment: this.resolved.env,
      limit: this.resolved.limit,
      skip: this.resolved.skip,
    });
    const deployments = page.deployments.filter(hasUid);

    renderTable(
      this.ux,
      deploymentColumns(project.projectType !== 'FILEUPLOAD'),
      deployments,
      process.stdout.columns,
      undefined,
      this.services.outputIsTTY,
    );
    renderPagination(this.ux, { ...page.pagination, skip: this.resolved.skip }, deployments.length);
  }
}
