import type { ServiceContext } from '../core/service-context';
import { asSentence, messageOf } from '../core/values';
import { DeploymentFollower } from '../deployments/deployment.follower';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import type { WatchTiming } from '../deployments/deployment.watcher';
import type { Deployment } from '../deployments/types';
import type { Environment } from '../environments/types';
import { deploymentFailureMessage } from './project.presenter';
import type { IdentifiedProject } from './types';

const NO_DEPLOYMENT_STATUS = 'NONE';
const FIRST_LOOKUP_ATTEMPTS = 3;

interface Survivors {
  org: string;
  project: IdentifiedProject;
  envName: string;
  environment?: Environment;
  deployment?: Deployment;
}

export class FirstDeploymentFollower {
  private readonly follower: DeploymentFollower;

  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {
    this.follower = new DeploymentFollower(services, timing);
  }

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
      this.follower.watch(scope),
    );

    if (outcome.kind === 'success') {
      await this.follower.announceLive(outcome.deployment, environment.domains);
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
}
