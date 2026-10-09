import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { ProjectUpdater } from '../../../projects/project.update';

const updateInputs = inputs({
  org: { required: true },
  project: { required: true },
  name: {},
  description: {},
});

export default class ProjectsUpdate extends LaunchCommand<typeof updateInputs> {
  static description = 'Update a Launch project';

  static examples = [
    '$ csdx launch:projects:update',
    '$ csdx launch:projects:update --org <org-uid> --project <name-or-uid> --name <new-name>',
    '$ csdx launch:projects:update --org <org-uid> --project <name-or-uid> --description <new-description>',
  ];

  static inputs = updateInputs;

  static flags = flagsFor(updateInputs);

  async run(): Promise<void> {
    const { org, project, name, description } = this.resolved;

    await new ProjectUpdater(this.services).update({ org, project, name, description });
  }
}
