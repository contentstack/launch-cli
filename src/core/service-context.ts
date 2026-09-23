import { ApiSurface, buildApi } from '../resources';
import { RestApiClient } from '../transport/rest-client';
import { selectAuthStrategy } from '../transport/auth-strategy';
import { getManageApiBaseUrl } from './region';
import { UxLike } from './render';

export interface ServiceContextOptions {
  launchHubUrl: string;
  analyticsInfo: string;
  ux: UxLike;
  isTTY: boolean;
}

export interface ServiceContext {
  api: ApiSurface;
  ux: UxLike;
  isTTY: boolean;
}

export function buildServiceContext(options: ServiceContextOptions): ServiceContext {
  const client = new RestApiClient({
    baseUrl: getManageApiBaseUrl(options.launchHubUrl),
    analyticsInfo: options.analyticsInfo,
    auth: selectAuthStrategy(),
  });

  return { api: buildApi(client), ux: options.ux, isTTY: options.isTTY };
}
