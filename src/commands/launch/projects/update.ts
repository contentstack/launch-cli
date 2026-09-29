import { LaunchCommand } from '../../../core/launch-command';
import { UsageError } from '../../../core/errors';
import { flagsFor, inputs } from '../../../core/inputs';
import {
  PROJECT_UPDATABLE_FIELDS,
  projectNotUpdatedLine,
  projectUpdatedLine,
} from '../../../projects/project.presenter';
import { promptForProjectUpdate } from '../../../projects/project.update.prompt';
import type { ProjectUpdate } from '../../../projects/types';

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
    const requested = await this.completeUpdate(org, project, { name, description });

    if (requested === undefined) {
      return;
    }

    await this.services.api.projects.update({ org, project, update: requested });

    this.ux.print(projectUpdatedLine(this.services.outputIsTTY === true));
  }

  private async completeUpdate(
    org: string,
    project: string,
    supplied: ProjectUpdate,
  ): Promise<ProjectUpdate | undefined> {
    const missing = PROJECT_UPDATABLE_FIELDS.filter((field) => supplied[field] === undefined);

    if (missing.length === 0) {
      return supplied;
    }

    if (!this.services.isTTY) {
      if (missing.length === PROJECT_UPDATABLE_FIELDS.length) {
        throw new UsageError('Pass at least one of --name, --description; none was supplied.');
      }

      return supplied;
    }

    const current = await this.services.api.projects.get({ org, project });
    const prompted = await promptForProjectUpdate(this.services.ux, current, missing);
    const update = { ...supplied, ...prompted };

    if (!PROJECT_UPDATABLE_FIELDS.some((field) => update[field] !== undefined)) {
      this.ux.print(projectNotUpdatedLine(this.services.outputIsTTY === true));
      return undefined;
    }

    return update;
  }
}
