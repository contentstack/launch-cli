import type { StatusKind } from './deployment.status';
import type { Deployment } from './types';

const MARKERS: Record<StatusKind, string> = {
  'in-flight': '→',
  unknown: '→',
  success: '✔',
  failure: '✖',
};

export function deploymentLabel(deployment: Deployment): string {
  return typeof deployment.deploymentNumber === 'number' && Number.isFinite(deployment.deploymentNumber)
    ? `#${deployment.deploymentNumber}`
    : (deployment.uid ?? 'with no number');
}

export function deploymentStatusLine(deployment: Deployment, status: string, kind: StatusKind): string {
  return `${MARKERS[kind]} Deployment ${deploymentLabel(deployment)} is ${status}`;
}

export function deploymentHeartbeatLine(status: string): string {
  return `  … still ${status}`;
}

export function deploymentUrlOf(deployment: Deployment): string | undefined {
  const url = deployment.deploymentUrl || deployment.previewUrl;

  if (!url) {
    return undefined;
  }

  return url.startsWith('http') ? url : `https://${url}`;
}
