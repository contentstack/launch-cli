import { stripVTControlCharacters } from 'node:util';

import type { Deployment, DeploymentLog } from './types';

export function deploymentUrlOf(deployment: Deployment): string | undefined {
  const url = deployment.deploymentUrl || deployment.previewUrl;

  if (!url) {
    return undefined;
  }

  return url.startsWith('http') ? url : `https://${url}`;
}

export function deploymentLogLine(log: DeploymentLog): string {
  const time = Date.parse(log.timestamp ?? '');
  const message = stripVTControlCharacters(log.message ?? '');

  if (Number.isNaN(time)) {
    return message;
  }

  const stamp = `${new Date(time).toISOString().slice(0, 23).replace('T', ' ')}:`;

  return message === '' ? stamp : `${stamp}  ${message}`;
}

export function deploymentLogsUnavailableLine(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);

  return `  ! Could not read the deployment logs (${reason}). Still waiting on the deployment.`;
}
