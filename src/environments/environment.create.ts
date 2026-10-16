import { askText, needInput } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { DeploymentFollower } from '../deployments/deployment.follower';
import { untilFound } from '../deployments/deployment.lookup';
import type { WatchTiming } from '../deployments/deployment.watcher';
import { asSentence, messageOf } from '../core/values';
import { askBranch } from '../git/git.prompt';
import { LaunchApiError } from '../transport/errors';
import { FolderUploader } from '../uploads/upload.folder';
import { EnvironmentBuilder } from './environment.builder';
import type { GitScope } from './environment.rules';
import { gitScopeOf, withoutRepositoryFlags } from './environment.rules';
import type { ToggleValue } from './environment.inputs';
import { ENVIRONMENT_NAME_MAX_LENGTH } from './environment.inputs';
import { environmentCreatedLine, environmentDeploymentFailureMessage } from './environment.presenter';
import type {
  DetectedFramework,
  EnvironmentRequest,
  EnvironmentSource,
  IdentifiedEnvironment,
} from './types';

export interface EnvironmentCreateRequest extends EnvironmentRequest {
  org: string;
  project: string;
  dataDir: string;
  configPath: string;
  name?: string;
  description?: string;
  branch?: string;
  autoDeploy?: ToggleValue;
}

interface NamedSource {
  name: string;
  source: EnvironmentSource;
}

async function detection(detect: () => Promise<DetectedFramework>): Promise<DetectedFramework> {
  try {
    return await detect();
  } catch (error) {
    if (error instanceof LaunchApiError && error.status === 404) {
      return {};
    }

    throw error;
  }
}

const NO_DEPLOYMENT_STATUS = 'NONE';

interface Followed {
  scope: { org: string; project: string; environment: IdentifiedEnvironment; name: string };
  deploymentUid?: string;
}

export class EnvironmentCreator {
  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {}

  async create(given: EnvironmentCreateRequest): Promise<void> {
    const { org, project } = given;
    const current = await this.services.api.projects.get({ org, project });
    const request = withoutRepositoryFlags(
      given,
      current.projectType,
      this.services.ux,
      this.services.outputIsTTY === true,
    );

    const { name, source } =
      current.projectType === 'FILEUPLOAD'
        ? await this.fromUpload(request)
        : await this.fromRepository(request, gitScopeOf(org, current.repository));

    const input = await new EnvironmentBuilder(this.services).build(request, name, source, request.autoDeploy);

    if (request.description !== undefined) {
      input.description = request.description;
    }

    const environment = await this.services.api.environments.create({ org, project, input });

    this.services.ux.print(environmentCreatedLine(this.services.outputIsTTY === true));

    await this.follow(request, environment, name);
  }

  private async fromUpload(request: EnvironmentCreateRequest): Promise<NamedSource> {
    const source = await this.uploadSource(request);

    return { name: await this.environmentName(request), source };
  }

  private async fromRepository(request: EnvironmentCreateRequest, git: GitScope): Promise<NamedSource> {
    const name = await this.environmentName(request);

    return { name, source: await this.gitSource(request, git) };
  }

  private environmentName(request: EnvironmentCreateRequest): Promise<string> {
    return needInput(this.services, 'name', request.name, () =>
      askText(this.services.ux, 'Environment name', undefined, ENVIRONMENT_NAME_MAX_LENGTH),
    );
  }

  private async uploadSource(request: EnvironmentCreateRequest): Promise<EnvironmentSource> {
    const { org, project } = request;
    const uploadUid = await new FolderUploader(this.services).upload({ org, project }, request.dataDir, [
      request.configPath,
    ]);
    const detected = await detection(() => this.services.api.projects.fileFramework({ org, uploadUid }));

    return { detected, uploadUid };
  }

  private async gitSource(
    request: EnvironmentCreateRequest,
    git: GitScope,
  ): Promise<EnvironmentSource> {
    const branch = await needInput(this.services, 'branch', request.branch, () => askBranch(this.services, git));
    const detected = await detection(() =>
      this.services.api.projects.gitFramework({
        org: git.org,
        provider: git.provider,
        repoName: git.repoName,
        branchName: branch,
        namespace: git.namespace,
      }),
    );

    return { detected, branch };
  }

  private async follow(
    request: EnvironmentCreateRequest,
    environment: IdentifiedEnvironment,
    name: string,
  ): Promise<void> {
    const { org, project } = request;
    const followed: Followed = { scope: { org, project, environment, name } };
    const scope = { org, project, environment: environment.uid };
    const deployment = await this.explaining(followed, () =>
      untilFound(() => this.services.api.deployments.latest(scope), this.timing),
    );

    if (deployment === undefined) {
      throw this.unsuccessful(followed, NO_DEPLOYMENT_STATUS);
    }

    followed.deploymentUid = deployment.uid;

    const follower = new DeploymentFollower(this.services, this.timing);
    const outcome = await this.explaining(followed, () => follower.watch({ ...scope, deployment: deployment.uid }));

    if (outcome.kind !== 'success') {
      throw this.unsuccessful(followed, outcome.status, undefined, outcome.kind === 'timed-out');
    }

    await follower.announceLive(outcome.deployment, environment.domains);
  }

  private async explaining<T>(followed: Followed, step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      throw this.unsuccessful(followed, NO_DEPLOYMENT_STATUS, asSentence(messageOf(error)));
    }
  }

  private unsuccessful(
    followed: Followed,
    status: string,
    reason?: string,
    timedOut?: boolean,
  ): DeploymentUnsuccessfulError {
    const { org, project, environment, name } = followed.scope;

    return new DeploymentUnsuccessfulError(
      environmentDeploymentFailureMessage({
        org,
        project,
        environmentName: environment.name ?? name,
        environmentUid: environment.uid,
        deploymentUid: followed.deploymentUid,
        status,
        reason,
        timedOut,
      }),
    );
  }
}
