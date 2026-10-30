import type { InterruptSource } from '../core/interruptible-ux';
import type { ServiceContext } from '../core/service-context';
import { asSentence, messageOf } from '../core/values';
import { DeploymentUnsuccessfulError, DeploymentWaitInterruptedError } from './deployment.errors';
import type { DeploymentScope as FollowedDeployment } from './deployment.follower';
import { DeploymentFollower } from './deployment.follower';
import {
  rollbackInterruptedMessage,
  rollbackStartedLine,
  rollbackUnconfirmedMessage,
} from './deployment.presenter';
import type { DeploymentOutcome, WatchTiming } from './deployment.watcher';
import type { DeploymentScope } from './deployments.api';

export interface RollbackRequest extends DeploymentScope {
  deployment: string;
  reason?: string;
}

export interface RollbackFollowing {
  waitUntilLive(scope: FollowedDeployment, stop?: AbortSignal): Promise<DeploymentOutcome>;
}

export interface DeploymentRollbackDeps {
  signals?: InterruptSource;
  follower?: RollbackFollowing;
}

export class DeploymentRollback {
  private readonly follower: RollbackFollowing;
  private readonly signals: InterruptSource;

  constructor(
    private readonly services: ServiceContext,
    timing: WatchTiming,
    deps: DeploymentRollbackDeps = {},
  ) {
    this.follower = deps.follower ?? new DeploymentFollower(services, timing);
    this.signals = deps.signals ?? process;
  }

  async rollback(request: RollbackRequest): Promise<void> {
    await this.services.api.deployments.rollback(request);

    this.services.ux.print(rollbackStartedLine(request.deployment));

    const followed = {
      org: request.org,
      project: request.project,
      environment: request.environment,
      deployment: request.deployment,
    };
    const outcome = await this.waitFor(followed);

    if (outcome.kind !== 'success') {
      throw new DeploymentUnsuccessfulError(rollbackUnconfirmedMessage(followed, { status: outcome.status }));
    }
  }

  private async waitFor(followed: FollowedDeployment): Promise<DeploymentOutcome> {
    const stop = new AbortController();
    const interrupt = (): void =>
      stop.abort(new DeploymentWaitInterruptedError(rollbackInterruptedMessage(followed)));

    this.signals.on('SIGINT', interrupt);

    try {
      return await this.follower.waitUntilLive(followed, stop.signal);
    } catch (error) {
      if (stop.signal.aborted) {
        throw stop.signal.reason;
      }

      throw new DeploymentUnsuccessfulError(
        rollbackUnconfirmedMessage(followed, { status: 'NONE', reason: asSentence(messageOf(error)) }),
      );
    } finally {
      this.signals.removeListener('SIGINT', interrupt);
    }
  }
}
