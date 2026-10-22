import { UsageError } from '../core/errors';
import { uidByName } from '../core/name-lookup';
import type { ResourceRef } from '../core/resource-ref';
import type { GetProjectParams, PageProjectsParams } from './projects.api';
import type { Project, ProjectsPage } from './types';

export interface ProjectPages {
  pages(params: PageProjectsParams): AsyncGenerator<ProjectsPage>;
  get(params: GetProjectParams): Promise<Project>;
}

export class ProjectResolver {
  constructor(private readonly projects: ProjectPages) {}

  async toUid(org: string, ref: ResourceRef): Promise<string> {
    if (ref.kind === 'uid') {
      await this.assertBelongsTo(org, ref.uid);
    }

    return uidByName(
      () => this.projects.pages({ org }),
      (page) => page.projects,
      ref,
      (name) => new UsageError(`No project named "${name}" found in this organization.`),
    );
  }

  private async assertBelongsTo(org: string, uid: string): Promise<void> {
    const { organizationUid } = await this.projects.get({ org, project: uid });

    if (organizationUid !== undefined && organizationUid !== org) {
      throw new UsageError(`No project with UID "${uid}" found in this organization.`);
    }
  }
}
