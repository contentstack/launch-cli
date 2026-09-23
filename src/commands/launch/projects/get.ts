import { Project } from '../../../projects/types';
import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderDetail } from '../../../core/render';

export function projectDetailFields(project: Project): [string, string][] {
  return [
    ['uid', project.uid ?? ''],
    ['name', project.name ?? ''],
    ['description', project.description ?? ''],
    ['type', project.projectType ?? ''],
  ];
}

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
