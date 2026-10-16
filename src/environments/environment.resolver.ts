import { UsageError } from '../core/errors';
import { uidByName } from '../core/name-lookup';
import type { ResourceRef } from '../core/resource-ref';
import type { PageEnvironmentsParams } from './environments.api';
import type { EnvironmentsPage } from './types';

export interface EnvironmentPages {
  pages(params: PageEnvironmentsParams): AsyncGenerator<EnvironmentsPage>;
}

export class EnvironmentResolver {
  constructor(private readonly environments: EnvironmentPages) {}

  toUid(scope: PageEnvironmentsParams, ref: ResourceRef): Promise<string> {
    return uidByName(
      () => this.environments.pages(scope),
      (page) => page.environments,
      ref,
      (name) => new UsageError(`No environment named "${name}" found in this project.`),
    );
  }
}
