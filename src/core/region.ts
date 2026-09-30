import { UsageError } from './errors';

const MANAGE_API_PATH = 'manage';
const LOGS_API_PATH = 'logs';
const CONNECTED_ACCOUNTS_PATH = '#!/launch/settings/connected-accounts';

export interface RegionLike {
  launchHubUrl?: string;
  cma?: string;
  uiHost?: string;
}

export function resolveLaunchHubUrl(region: RegionLike | undefined): string {
  if (region?.launchHubUrl) {
    return region.launchHubUrl;
  }

  const cma = region?.cma;

  if (!cma) {
    throw new UsageError('Region not configured. Please set the region with command $ csdx config:set:region');
  }

  let host = cma.replace('api', 'launch-api').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');

  if (host.startsWith('dev11')) {
    host = host.replace('dev11', 'dev');
  }

  const [hostName, ...path] = host.split('/');

  return `https://${[onComDomain(hostName), ...path].join('/')}`;
}

function onComDomain(hostName: string): string {
  return hostName.endsWith('.io') ? `${hostName.slice(0, -'.io'.length)}.com` : hostName;
}

/**
 * V1's rule for turning a cma host into an app host: `api` becomes `app` in the leading label, where
 * every Contentstack region carries it (`api`, `eu-api`, `dev11-api`, `azure-na-api`). It is read
 * only from that label so a host with `api` elsewhere is not mangled, and a host that has none at
 * all - `cma.example.com` - yields nothing rather than a guess.
 */
function appHostOf(hostName: string): string | undefined {
  const [label, ...domain] = hostName.split('.');
  const marker = label.lastIndexOf('api');

  if (marker === -1) {
    return undefined;
  }

  return [`${label.slice(0, marker)}app${label.slice(marker + 'api'.length)}`, ...domain].join('.');
}

/**
 * The Launch app is the Contentstack app: the region names it as `uiHost`, and only when a region
 * predates that field does this fall back to reading the cma host as an app host. A URL that cannot
 * be derived is answered as none, because create prints this one *and opens a browser at it* - a
 * wrong address is worse there than no address, which the caller already reports gracefully.
 */
export function resolveLaunchAppUrl(region: RegionLike | undefined): string | undefined {
  if (region?.uiHost) {
    return region.uiHost.startsWith('http') ? region.uiHost : `https://${region.uiHost}`;
  }

  const cma = region?.cma;

  if (!cma) {
    return undefined;
  }

  const [hostName, ...path] = cma.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/');
  const appHost = appHostOf(hostName);

  return appHost === undefined ? undefined : `https://${[onComDomain(appHost), ...path].join('/')}`;
}

export function connectedAccountsUrl(launchAppUrl: string): string {
  return `${launchAppUrl.replace(/\/+$/, '')}/${CONNECTED_ACCOUNTS_PATH}`;
}

function underHub(launchHubUrl: string, path: string): string {
  return `${launchHubUrl.replace(/\/+$/, '')}/${path}`;
}

export function getManageApiBaseUrl(launchHubUrl: string): string {
  return underHub(launchHubUrl, MANAGE_API_PATH);
}

export function getLogsApiBaseUrl(launchHubUrl: string): string {
  return underHub(launchHubUrl, LOGS_API_PATH);
}
