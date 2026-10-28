import { UsageError } from '../core/errors';
import type { InterruptSource } from '../core/interruptible-ux';
import type { ServiceContext } from '../core/service-context';
import { asSentence, messageOf } from '../core/values';
import { FolderUploader } from '../uploads/upload.folder';
import { NoUploadDirectoryError } from '../uploads/upload.errors';
import { DeploymentUnsuccessfulError, DeploymentWaitInterruptedError } from './deployment.errors';
import type { DeploymentScope as FollowedDeployment } from './deployment.follower';
import { DeploymentFollower } from './deployment.follower';
import { PICK_COMMIT } from './deployment.inputs';
import { firstDeploymentFailureMessage } from './deployment.presenter';
import type { DeploymentOutcome, WatchTiming } from './deployment.watcher';
import type { DeploymentScope } from './deployments.api';
import type { Deployment, IdentifiedDeployment } from './types';

const FILE_UPLOAD_PROJECT = 'FILEUPLOAD';

export interface CreateDeploymentRequest extends DeploymentScope {
  dataDir: string;
  configPath: string;
  commit?: string;
  lastUpload: boolean;
}

export interface DeploymentFollowing {
  watch(scope: FollowedDeployment, stop?: AbortSignal): Promise<DeploymentOutcome>;
  announceLive(deployment: Deployment): Promise<void>;
}

export interface DeploymentCreatorDeps {
  pickCommit(scope: DeploymentScope): Promise<string>;
  signals?: InterruptSource;
  follower?: DeploymentFollowing;
}

interface Source {
  commitHash?: string;
  uploadUid?: string;
}

function lastUploadOnGitHub(): UsageError {
  return new UsageError(
    '--last-upload only applies to FileUpload projects; this project deploys from GitHub, so it has no uploaded ' +
      'bundle to redeploy. Pass --commit <sha> to deploy a specific commit, or pass neither flag to deploy the ' +
      'branch tip.',
  );
}

function commitOnFileUpload(): UsageError {
  return new UsageError(
    '--commit only applies to GitHub projects; this FileUpload project has no connected repository. ' +
      'Pass --last-upload to redeploy the last uploaded bundle.',
  );
}

function noProjectDirectory(path: string): UsageError {
  return new UsageError(
    `no project directory found at ${path}. Use --last-upload to redeploy the last uploaded bundle, ` +
      'or run from your project directory / pass --data-dir.',
  );
}

export class DeploymentCreator {
  private readonly follower: DeploymentFollowing;
  private readonly signals: InterruptSource;

  constructor(
    private readonly services: ServiceContext,
    timing: WatchTiming,
    private readonly deps: DeploymentCreatorDeps,
  ) {
    this.follower = deps.follower ?? new DeploymentFollower(services, timing);
    this.signals = deps.signals ?? process;
  }

  async create(request: CreateDeploymentRequest): Promise<void> {
    const scope = { org: request.org, project: request.project, environment: request.environment };
    const project = await this.services.api.projects.get({ org: request.org, project: request.project });
    const source =
      project.projectType === FILE_UPLOAD_PROJECT
        ? await this.fileUploadSource(request, scope)
        : await this.gitSource(request, scope);

    const deployment = await this.services.api.deployments.create({ ...scope, ...source });

    await this.follow(scope, deployment);
  }

  private async gitSource(request: CreateDeploymentRequest, scope: DeploymentScope): Promise<Source> {
    if (request.lastUpload) {
      throw lastUploadOnGitHub();
    }

    if (request.commit === undefined) {
      return {};
    }

    return { commitHash: request.commit === PICK_COMMIT ? await this.deps.pickCommit(scope) : request.commit };
  }

  private async fileUploadSource(request: CreateDeploymentRequest, scope: DeploymentScope): Promise<Source> {
    if (request.commit !== undefined) {
      throw commitOnFileUpload();
    }

    if (request.lastUpload) {
      return {};
    }

    try {
      const uploader = new FolderUploader(this.services);

      return { uploadUid: await uploader.upload(scope, request.dataDir, [request.configPath]) };
    } catch (error) {
      throw error instanceof NoUploadDirectoryError ? noProjectDirectory(request.dataDir) : error;
    }
  }

  private async follow(scope: DeploymentScope, deployment: IdentifiedDeployment): Promise<void> {
    const followed = { ...scope, deployment: deployment.uid };
    const outcome = await this.waitFor(followed);

    if (outcome.kind === 'success') {
      await this.follower.announceLive(outcome.deployment);
      return;
    }

    throw this.unsuccessful(followed, { status: outcome.status, timedOut: outcome.kind === 'timed-out' });
  }

  private async waitFor(followed: FollowedDeployment): Promise<DeploymentOutcome> {
    const stop = new AbortController();
    const interrupt = (): void => stop.abort(new DeploymentWaitInterruptedError(this.interruptedMessage(followed)));

    this.signals.on('SIGINT', interrupt);

    try {
      return await this.follower.watch(followed, stop.signal);
    } catch (error) {
      if (stop.signal.aborted) {
        throw stop.signal.reason;
      }

      throw this.unsuccessful(followed, { status: 'NONE', reason: asSentence(messageOf(error)) });
    } finally {
      this.signals.removeListener('SIGINT', interrupt);
    }
  }

  private interruptedMessage(followed: FollowedDeployment): string {
    return (
      `Stopped waiting for deployment ${followed.deployment}. It keeps running on Launch and was not cancelled. ` +
      `Run csdx launch:deployments:get --org ${followed.org} --project ${followed.project} ` +
      `--env ${followed.environment} --deployment ${followed.deployment} to see how it ends.`
    );
  }

  private unsuccessful(
    followed: FollowedDeployment,
    result: { status: string; timedOut?: boolean; reason?: string },
  ): DeploymentUnsuccessfulError {
    return new DeploymentUnsuccessfulError(
      firstDeploymentFailureMessage({
        created: `The deployment "${followed.deployment}"`,
        plural: false,
        org: followed.org,
        project: followed.project,
        environmentUid: followed.environment,
        deploymentUid: followed.deployment,
        status: result.status,
        timedOut: result.timedOut,
        reason: result.reason,
      }),
    );
  }
}
