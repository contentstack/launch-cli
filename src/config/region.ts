const MANAGE_API_PATH = 'manage';

export function getManageApiBaseUrl(launchHubUrl: string): string {
  return `${launchHubUrl.replace(/\/+$/, '')}/${MANAGE_API_PATH}`;
}
