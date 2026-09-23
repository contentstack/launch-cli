import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderDetail } from '../../../core/render';
import { projectDetailFields } from '../../../projects/project.presenter';

const getInputs = inputs({ org: { required: true }, project: { required: true } });

export default class ProjectsGet extends LaunchCommand<typeof getInputs> {
  static description = 'Show a single Launch project';

  static examples = ['$ csdx launch:projects:get --org <org-uid> --project <name-or-uid>'];

  static inputs = getInputs;

  static flags = flagsFor(getInputs);

  async run(): Promise<void> {
    const result = await this.services.api.projects.get({
      org: this.resolved.org,
      project: this.resolved.project,
    });

    renderDetail(this.ux, projectDetailFields(result));
  }
}
