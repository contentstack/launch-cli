import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { projectDeleteQuestion, projectDeletedLine } from '../../../projects/project.presenter';

const deleteInputs = inputs({ org: { required: true }, project: { required: true }, yes: {} });

export default class ProjectsDelete extends LaunchCommand<typeof deleteInputs> {
  static description = 'Delete a Launch project';

  static examples = [
    '$ csdx launch:projects:delete --org <org-uid> --project <name-or-uid>',
    '$ csdx launch:projects:delete --org <org-uid> --project <name-or-uid> --yes',
  ];

  static inputs = deleteInputs;

  static flags = flagsFor(deleteInputs);

  async run(): Promise<void> {
    const { org, project } = this.resolved;

    await this.confirm(projectDeleteQuestion(project));

    const found = await this.services.api.projects.get({ org, project });

    await this.services.api.projects.delete({ org, project });

    this.ux.print(projectDeletedLine(found, project));
  }
}
