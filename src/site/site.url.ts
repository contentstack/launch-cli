import { deploymentUrlOf } from '../deployments/deployment.presenter';
import type { Deployment } from '../deployments/types';

export interface SiteDomain {
  url?: string;
}

export function siteUrlOf(deployment: Deployment | undefined, domains: readonly SiteDomain[] = []): string | undefined {
  if (deployment === undefined) {
    return undefined;
  }

  const fromDeployment = deploymentUrlOf(deployment);

  if (fromDeployment !== undefined) {
    return fromDeployment;
  }

  const domain = domains.find((entry) => Boolean(entry.url));

  return domain === undefined ? undefined : deploymentUrlOf({ uid: deployment.uid, deploymentUrl: domain.url });
}

export function previewUrlOf(deployment: Deployment): string | undefined {
  const previewUrl = deployment.previewUrl?.trim();

  return previewUrl ? deploymentUrlOf({ uid: deployment.uid, previewUrl }) : undefined;
}
