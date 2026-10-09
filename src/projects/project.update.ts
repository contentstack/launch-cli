import { UsageError } from '../core/errors';
import type { ServiceContext } from '../core/service-context';
import { projectNotUpdatedLine, projectUpdatedLine } from './project.presenter';
import { PROJECT_UPDATABLE_FIELDS, promptForProjectUpdate } from './project.prompt';
import type { ProjectUpdate } from './types';

export interface UpdateRequest extends ProjectUpdate {
  org: string;
  project: string;
}

export class ProjectUpdater {
  constructor(private readonly services: ServiceContext) {}

  async update(request: UpdateRequest): Promise<void> {
    const { org, project, name, description } = request;
    const requested = await this.completeUpdate(org, project, { name, description });

    if (requested === undefined) {
      return;
    }

    await this.services.api.projects.update({ org, project, update: requested });

    this.services.ux.print(projectUpdatedLine(this.services.outputIsTTY === true));
  }

  private async completeUpdate(
    org: string,
    project: string,
    supplied: ProjectUpdate,
  ): Promise<ProjectUpdate | undefined> {
    if (PROJECT_UPDATABLE_FIELDS.some((field) => supplied[field] !== undefined)) {
      return supplied;
    }

    if (!this.services.isTTY) {
      throw new UsageError('Pass at least one of --name, --description; none was supplied.');
    }

    const current = await this.services.api.projects.get({ org, project });
    const prompted = await promptForProjectUpdate(this.services.ux, current);

    if (!PROJECT_UPDATABLE_FIELDS.some((field) => prompted[field] !== undefined)) {
      this.services.ux.print(projectNotUpdatedLine(this.services.outputIsTTY === true));
      return undefined;
    }

    return prompted;
  }
}
