import { authHandler, configHandler } from '@contentstack/cli-utilities';

import { ApiSurface, buildApi } from '../resources';
import { getManageApiBaseUrl } from './region';
import { RestApiClient } from '../transport/rest-client';
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

export async function authHeaders(): Promise<Record<string, string>> {
  const authorisationType = configHandler.get('authorisationType');

  if (authorisationType === 'OAUTH') {
    await authHandler.compareOAuthExpiry();
    return { authorization: `Bearer ${configHandler.get('oauthAccessToken')}` };
  }

  return { authtoken: configHandler.get('authtoken') };
}

export function buildServiceContext(options: ServiceContextOptions): ServiceContext {
  const isOAuthSession = configHandler.get('authorisationType') === 'OAUTH';

  const client = new RestApiClient({
    baseUrl: getManageApiBaseUrl(options.launchHubUrl),
    analyticsInfo: options.analyticsInfo,
    authHeaders,
    refreshAuth: isOAuthSession ? () => authHandler.compareOAuthExpiry(true) : undefined,
  });

  return { api: buildApi(client), ux: options.ux, isTTY: options.isTTY };
}
