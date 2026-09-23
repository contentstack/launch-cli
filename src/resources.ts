import { RestApiClient } from './transport/rest-client';
import { ProjectsApi } from './projects/projects.api';

export * from './projects/projects.api';
export * from './projects/types';

export interface ApiSurface {
  projects: ProjectsApi;
}

export function buildApi(client: RestApiClient): ApiSurface {
  return { projects: new ProjectsApi(client) };
}
