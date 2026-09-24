import { UsageError } from '../core/errors';
import type { ProjectRef } from './project-ref';
import { hasUid } from '../transport/envelope';
import type { PageProjectsParams } from './projects.api';
import type { ProjectsPage } from './types';

export interface ProjectPages {
  pages(params: PageProjectsParams): AsyncGenerator<ProjectsPage>;
}

export class ProjectResolver {
  constructor(private readonly projects: ProjectPages) {}

  async toUid(org: string, ref: ProjectRef): Promise<string> {
    if (ref.kind === 'uid') {
      return ref.uid;
    }

    for await (const page of this.projects.pages({ org })) {
      const match = page.projects.filter(hasUid).find((project) => project.name === ref.name);

      if (match) {
        return match.uid;
      }
    }

    throw new UsageError(`No project named "${ref.name}" found in this organization.`);
  }
}
