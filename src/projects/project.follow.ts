import type { Loader } from '../core/loader';
import { silentLoader, terminalLoader } from '../core/loader';
import type { ServiceContext } from '../core/service-context';
import { asSentence, messageOf } from '../core/values';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { deploymentUrlOf } from '../deployments/deployment.presenter';
import type { WatchTiming } from '../deployments/deployment.watcher';
import { watchDeployment } from '../deployments/deployment.watcher';
import type { Deployment } from '../deployments/types';
import type { Environment } from '../environments/types';
import { deploymentFailureMessage, deploymentUrlLine } from './project.presenter';
import type { IdentifiedProject } from './types';

export const NO_DEPLOYMENT_STATUS = 'NONE';
export const FIRST_LOOKUP_ATTEMPTS = 3;
export const SITE_OPEN_DELAY_MS = 6000;

interface Survivors {
  org: string;
  project: IdentifiedProject;
  envName: string;
  environment?: Environment;
  deployment?: Deployment;
}

export class DeploymentFollower {
  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {}

  async follow(org: string, project: IdentifiedProject, envName: string): Promise<void> {
    const environment = await this.explaining({ org, project, envName }, () =>
      this.appearing(() => this.services.api.environments.first({ org, project: project.uid })),
    );

    if (environment === undefined) {
      throw this.unsuccessful({ org, project, envName, status: NO_DEPLOYMENT_STATUS });
    }

    const deployment = await this.explaining({ org, project, envName, environment }, () =>
      this.appearing(() =>
        this.services.api.deployments.latest({ org, project: project.uid, environment: environment.uid }),
      ),
    );

    if (deployment === undefined) {
      throw this.unsuccessful({ org, project, envName, environment, status: NO_DEPLOYMENT_STATUS });
    }

    const scope = { org, project: project.uid, environment: environment.uid, deployment: deployment.uid };
    const outcome = await this.explaining({ org, project, envName, environment, deployment }, () =>
      watchDeployment({
        ...this.timing,
        ux: this.services.ux,
        outputIsTTY: this.services.outputIsTTY === true,
        loader: this.loader(),
        logs: (after) => this.services.api.deploymentLogs.after({ ...scope, timestamp: after }),
        poll: () => this.services.api.deployments.get(scope),
      }),
    );

    if (outcome.kind === 'success') {
      const url = this.siteUrl(outcome.deployment, environment);

      if (url !== undefined) {
        this.services.ux.print(deploymentUrlLine(url, this.services.outputIsTTY === true));
        await this.openSite(url);
      }

      return;
    }

    throw this.unsuccessful({
      org,
      project,
      envName,
      environment,
      deployment,
      status: outcome.status,
      timedOut: outcome.kind === 'timed-out',
    });
  }

  private async appearing<T>(lookup: () => Promise<T | undefined>): Promise<T | undefined> {
    for (let attempt = 1; attempt < FIRST_LOOKUP_ATTEMPTS; attempt += 1) {
      const found = await lookup();

      if (found !== undefined) {
        return found;
      }

      await this.timing.sleep(this.timing.pollDelayMs);
    }

    return lookup();
  }

  private async explaining<T>(survivors: Survivors, step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      throw this.unsuccessful({ ...survivors, status: NO_DEPLOYMENT_STATUS, reason: asSentence(messageOf(error)) });
    }
  }

  private unsuccessful(
    failure: Survivors & { status: string; reason?: string; timedOut?: boolean },
  ): DeploymentUnsuccessfulError {
    return new DeploymentUnsuccessfulError(
      deploymentFailureMessage({
        reason: failure.reason,
        org: failure.org,
        projectName: failure.project.name ?? failure.project.uid,
        projectUid: failure.project.uid,
        environmentName: failure.environment?.name ?? failure.envName,
        environmentUid: failure.environment?.uid,
        deploymentUid: failure.deployment?.uid,
        status: failure.status,
        timedOut: failure.timedOut,
      }),
    );
  }

  private siteUrl(deployment: Deployment, environment: Environment): string | undefined {
    const fromDeployment = deploymentUrlOf(deployment);

    if (fromDeployment !== undefined) {
      return fromDeployment;
    }

    const domain = (environment.domains ?? []).find((entry) => Boolean(entry.url));

    return domain === undefined ? undefined : deploymentUrlOf({ uid: deployment.uid, deploymentUrl: domain.url });
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
