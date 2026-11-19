import { webUrlOf } from '../core/url';
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

  return domains.map((entry) => webUrlOf(entry.url)).find((url) => url !== undefined);
}
