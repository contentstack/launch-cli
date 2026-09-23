import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { atLeastOneOf } from '../../../core/rules';
import { projectUpdatedLines } from '../../../projects/project.presenter';

const updateInputs = inputs({
  org: { required: true },
  project: { required: true },
  name: {},
  description: {},
});

export default class ProjectsUpdate extends LaunchCommand<typeof updateInputs> {
  static description = 'Update a Launch project';

  static examples = [
    '$ csdx launch:projects:update --org <org-uid> --project <name-or-uid> --name <new-name>',
    '$ csdx launch:projects:update --org <org-uid> --project <name-or-uid> --description <new-description>',
  ];

  static inputs = updateInputs;

  static flags = flagsFor(updateInputs);

  static rules = [atLeastOneOf('name', 'description')];

  async run(): Promise<void> {
    const { org, project, name, description } = this.resolved;
    const requested = { name, description };

    const updated = await this.services.api.projects.update({ org, project, update: requested });

    for (const line of projectUpdatedLines(requested, updated)) {
      this.ux.print(line);
    }
  }
}
