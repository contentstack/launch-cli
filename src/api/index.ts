import { RestApiClient } from '../http/rest-client';
import { ProjectsApi } from './projects';

export * from './projects';
export * from './types';

export interface ApiSurface {
  projects: ProjectsApi;
}

export function buildApi(client: RestApiClient): ApiSurface {
  return { projects: new ProjectsApi(client) };
}
