import { Project } from '../../../api/types';
import { LaunchCommand } from '../../../base/launch-command';
import { flagsFor, inputs } from '../../../flags/inputs';
import { renderDetail } from '../../../output/render';

export function projectDetailFields(project: Project): [string, string][] {
  return [
    ['uid', project.uid ?? ''],
    ['name', project.name ?? ''],
    ['description', project.description ?? ''],
    ['type', project.projectType ?? ''],
  ];
}

export default class ProjectsGet extends LaunchCommand<'org' | 'project'> {
  static description = 'Show a single Launch project';

  static examples = ['$ csdx launch:projects:get --org <org-uid> --project <name-or-uid>'];

  static inputs = inputs({ org: { required: true }, project: { required: true } });

  static flags = flagsFor(ProjectsGet.inputs);

  async run(): Promise<void> {
    const result = await this.services.api.projects.get({
      org: this.resolved.org as string,
      project: this.resolved.project as string,
    });

    renderDetail(this.ux, projectDetailFields(result));
  }
}
