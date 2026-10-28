import type { Loader } from '../core/loader';
import { silentLoader, terminalLoader } from '../core/loader';
import type { ServiceContext } from '../core/service-context';
import type { SiteDomain } from '../site/site.url';
import { siteUrlOf } from '../site/site.url';
import { deploymentUrlLine } from './deployment.presenter';
import type { DeploymentOutcome, WatchTiming } from './deployment.watcher';
import { watchDeployment } from './deployment.watcher';
import type { Deployment } from './types';

export const SITE_OPEN_DELAY_MS = 6000;

export interface DeploymentScope {
  org: string;
  project: string;
  environment: string;
  deployment: string;
}

export class DeploymentFollower {
  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {}

  watch(scope: DeploymentScope, stop?: AbortSignal): Promise<DeploymentOutcome> {
    return watchDeployment({
      ...this.timing,
      ux: this.services.ux,
      outputIsTTY: this.services.outputIsTTY === true,
      loader: this.loader(),
      stop,
      logs: (after) => this.services.api.deploymentLogs.after({ ...scope, timestamp: after }),
      poll: () => this.services.api.deployments.get(scope),
    });
  }

  async announceLive(deployment: Deployment, domains: readonly SiteDomain[] = []): Promise<void> {
    const url = siteUrlOf(deployment, domains);

    if (url === undefined) {
      return;
    }

    this.services.ux.print(deploymentUrlLine(url, this.services.outputIsTTY === true));
    await this.openSite(url);
  }

  /**
   * V1 opened the live site once the deployment succeeded, waiting first because a site opened the
   * moment it reports live can still answer "site not reachable". The wait is awaited rather than
   * left on a timer so the browser opens before the command returns, whoever ends the process.
   */
  private async openSite(url: string): Promise<void> {
    if (this.services.openUrl === undefined) {
      return;
    }

    await this.timing.sleep(SITE_OPEN_DELAY_MS);
    this.services.openUrl(url);
  }

  private loader(): Loader {
    return this.services.outputIsTTY === true ? terminalLoader() : silentLoader;
  }
}
