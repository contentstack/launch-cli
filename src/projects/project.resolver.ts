import { UsageError } from '../core/errors';
import { uidByName } from '../core/name-lookup';
import type { ResourceRef } from '../core/resource-ref';
import type { PageProjectsParams } from './projects.api';
import type { ProjectsPage } from './types';

export interface ProjectPages {
  pages(params: PageProjectsParams): AsyncGenerator<ProjectsPage>;
}

export class ProjectResolver {
  constructor(private readonly projects: ProjectPages) {}

  toUid(org: string, ref: ResourceRef): Promise<string> {
    return uidByName(
      () => this.projects.pages({ org }),
      (page) => page.projects,
      ref,
      (name) => new UsageError(`No project named "${name}" found in this organization.`),
    );
  }
}
