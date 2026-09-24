import { ApiSurface, buildApi } from '../resources';
import { RestApiClient } from '../transport/rest-client';
import { selectAuthStrategy } from '../transport/auth-strategy';
import { createCmaSession } from '../transport/cma-client';
import { getManageApiBaseUrl } from './region';
import { UxLike } from './render';

export interface ServiceContextOptions {
  launchHubUrl: string;
  cma?: string;
  analyticsInfo: string;
  ux: UxLike;
  isTTY: boolean;
  outputIsTTY?: boolean;
}

export interface ServiceContext {
  api: ApiSurface;
  ux: UxLike;
  isTTY: boolean;
  outputIsTTY?: boolean;
}

export function buildServiceContext(options: ServiceContextOptions): ServiceContext {
  const client = new RestApiClient({
    baseUrl: getManageApiBaseUrl(options.launchHubUrl),
    analyticsInfo: options.analyticsInfo,
    auth: selectAuthStrategy(),
  });

  const cma = createCmaSession({ cma: options.cma, analyticsInfo: options.analyticsInfo });

  return {
    api: buildApi(client, cma),
    ux: options.ux,
    isTTY: options.isTTY,
    outputIsTTY: options.outputIsTTY === true,
  };
}
