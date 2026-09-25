import { UsageError } from './errors';

const MANAGE_API_PATH = 'manage';
const LOGS_API_PATH = 'logs';

export interface RegionLike {
  launchHubUrl?: string;
  cma?: string;
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
  const onComDomain = hostName.endsWith('.io') ? `${hostName.slice(0, -'.io'.length)}.com` : hostName;

  return `https://${[onComDomain, ...path].join('/')}`;
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
