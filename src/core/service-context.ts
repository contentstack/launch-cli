import type { ApiSurface } from '../resources';
import { buildApi } from '../resources';
import { RestApiClient } from '../transport/rest-client';
import { selectAuthStrategy } from '../transport/auth-strategy';
import { createCmaSession } from '../transport/cma-client';
import { getLogsApiBaseUrl, getManageApiBaseUrl, resolveLaunchAppUrl } from './region';
import { openInBrowser } from './browser';
import type { UxLike } from './prompt';

export interface ServiceContextOptions {
  launchHubUrl: string;
  cma?: string;
  uiHost?: string;
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
  launchAppUrl?: string;
  openUrl?: (url: string) => void;
}

export function buildServiceContext(options: ServiceContextOptions): ServiceContext {
  const auth = selectAuthStrategy();
  const clientFor = (baseUrl: string) => new RestApiClient({ baseUrl, analyticsInfo: options.analyticsInfo, auth });

  const cma = createCmaSession({ cma: options.cma, analyticsInfo: options.analyticsInfo });

  return {
    api: buildApi(
      clientFor(getManageApiBaseUrl(options.launchHubUrl)),
      cma,
      clientFor(getLogsApiBaseUrl(options.launchHubUrl)),
    ),
    ux: options.ux,
    isTTY: options.isTTY,
    outputIsTTY: options.outputIsTTY === true,
    launchAppUrl: resolveLaunchAppUrl({ cma: options.cma, uiHost: options.uiHost }),
    openUrl: openInBrowser,
  };
}
