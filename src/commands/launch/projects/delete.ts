import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { EXIT_CANCELLED } from '../../../core/constants';
import {
  PROJECT_DELETE_QUESTION,
  projectDeletedLine,
  projectNotDeletedLine,
} from '../../../projects/project.presenter';

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

    const outputIsTTY = this.services.outputIsTTY === true;

    await this.services.api.projects.get({ org, project });

    if (!(await this.confirm(PROJECT_DELETE_QUESTION))) {
      this.ux.print(projectNotDeletedLine(outputIsTTY));
      this.exit(EXIT_CANCELLED);
    }

    await this.services.api.projects.delete({ org, project });

    this.ux.print(projectDeletedLine(outputIsTTY));
  }
}
