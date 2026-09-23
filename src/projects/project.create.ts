import { MissingInputError, UsageError } from '../core/errors';
import { ProjectConfig, ProjectConfigStore } from '../core/project-config';
import { renderDetail } from '../core/render';
import type { ServiceContext } from '../core/service-context';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { deploymentUrlOf } from '../deployments/deployment.presenter';
import { WatchTiming, watchDeployment } from '../deployments/deployment.watcher';
import type { Deployment } from '../deployments/types';
import {
  FRAMEWORK_CHOICES,
  RESPONSE_MODES,
  TOGGLE_VALUES,
  frameworkPresetOf,
} from '../environments/environment.inputs';
import type { CreateEnvironmentInput, Environment, FrameworkPreset } from '../environments/types';
import { SERVER_COMMAND_FRAMEWORKS } from '../environments/types';
import { GIT_PROVIDER_GITHUB, GitRepository } from '../git/types';
import { archiveDirectory } from './project.archive';
import { askBranch, askChoice, askNamespace, askRepository, askText, repositoryLabel } from './project.create.prompt';
import { deploymentFailureMessage, projectCreatedFields } from './project.presenter';
import { PROJECT_TYPE_BY_CHOICE, PROJECT_TYPE_CHOICES, ProjectTypeChoice, projectTypeChoiceOf } from './project.inputs';
import { uploadArchive } from './project.upload';
import type { CreateProjectInput, DetectedFramework, Project } from './types';

export const DEFAULT_OUTPUT_DIRECTORY = './';
export const NO_DEPLOYMENT_STATUS = 'NONE';

export interface CreateRequest {
  org: string;
  dataDir: string;
  configPath?: string;
  type?: string;
  name?: string;
  description?: string;
  envName?: string;
  namespace?: string;
  repo?: string;
  branch?: string;
  framework?: string;
  buildCmd?: string;
  outputDir?: string;
  serverCmd?: string;
  resMode?: string;
  autoDeploy?: string;
  csAuth?: string;
}

interface SourceSelection {
  detected: DetectedFramework;
  repository?: GitRepository;
  namespace?: string;
  branch?: string;
  uploadUid?: string;
}

function emptyEnvironmentVariables(): [] {
  return [];
}

export class ProjectCreator {
  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {}

  async create(request: CreateRequest): Promise<void> {
    const choice = await this.projectType(request);
    const name = await this.need('name', request.name, () => askText(this.services.ux, 'Project name'));
    const envName = await this.need('env-name', request.envName, () =>
      askText(this.services.ux, 'Environment name'),
    );
    const source =
      choice === 'GitHub' ? await this.selectGitSource(request) : await this.selectUploadSource(request);
    const framework = await this.selectFramework(request, source.detected);

    const environment: CreateEnvironmentInput = {
      name: envName,
      gitBranch: source.branch,
      uploadUid: source.uploadUid,
      buildCommand: await this.need('build-cmd', request.buildCmd, () =>
        askText(this.services.ux, 'Build command', source.detected.buildCommand),
      ),
      outputDirectory: await this.need('output-dir', request.outputDir, () =>
        askText(this.services.ux, 'Output directory', source.detected.outputDirectory ?? DEFAULT_OUTPUT_DIRECTORY),
      ),
      serverCommand: await this.serverCommand(request, framework, source.detected),
      frameworkPreset: framework,
      environmentVariables: emptyEnvironmentVariables(),
      isStreamingEnabled: await this.streaming(request),
    };

    if (request.autoDeploy !== undefined) {
      environment.autoDeployOnPush = request.autoDeploy === TOGGLE_VALUES[0];
    }

    if (request.csAuth !== undefined) {
      environment.isContentstackAuthenticationEnabled = request.csAuth === TOGGLE_VALUES[0];
    }

    const input: CreateProjectInput = {
      name,
      projectType: PROJECT_TYPE_BY_CHOICE[choice],
      environment,
    };

    if (request.description !== undefined) {
      input.description = request.description;
    }

    if (source.repository !== undefined) {
      input.repository = {
        repositoryName: repositoryLabel(source.repository),
        username: source.namespace as string,
        repositoryUrl: source.repository.url ?? `https://github.com/${repositoryLabel(source.repository)}`,
        gitProviderMetadata: { gitProvider: GIT_PROVIDER_GITHUB },
      };
    }

    if (source.uploadUid !== undefined) {
      input.fileUpload = { uploadUid: source.uploadUid };
    }

    const project = await this.services.api.projects.create({ org: request.org, input });

    this.remember(request, project);

    await this.follow(request.org, project, envName);
  }

  private remember(request: CreateRequest, project: Project): void {
    const path = request.configPath;

    if (path === undefined) {
      return;
    }

    const config: ProjectConfig = { uid: project.uid, organizationUid: request.org };

    if (project.name !== undefined) {
      config.name = project.name;
    }

    try {
      new ProjectConfigStore(path).save(config);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      this.services.ux.print(
        `Could not record this project in ${path}: ${reason} ` +
          'Pass --org and --project explicitly when you run Launch commands in this folder.',
      );
    }
  }

  private async follow(org: string, project: Project, envName: string): Promise<void> {
    const environment = await this.services.api.environments.first({ org, project: project.uid });

    if (environment === undefined) {
      throw this.unsuccessful({ org, project, envName, status: NO_DEPLOYMENT_STATUS });
    }

    const deployment = await this.services.api.deployments.latest({
      org,
      project: project.uid,
      environment: environment.uid,
    });

    if (deployment === undefined) {
      throw this.unsuccessful({ org, project, envName, environment, status: NO_DEPLOYMENT_STATUS });
    }

    const outcome = await watchDeployment({
      ...this.timing,
      ux: this.services.ux,
      isTTY: this.services.isTTY,
      poll: () =>
        this.services.api.deployments.get({
          org,
          project: project.uid,
          environment: environment.uid,
          deployment: deployment.uid,
        }),
    });

    if (outcome.kind === 'success') {
      renderDetail(this.services.ux, projectCreatedFields(project, this.siteUrl(outcome.deployment, environment)));
      return;
    }

    throw this.unsuccessful({ org, project, envName, environment, deployment, status: outcome.status });
  }

  private unsuccessful(failure: {
    org: string;
    project: Project;
    envName: string;
    status: string;
    environment?: Environment;
    deployment?: Deployment;
  }): DeploymentUnsuccessfulError {
    return new DeploymentUnsuccessfulError(
      deploymentFailureMessage({
        org: failure.org,
        projectName: failure.project.name ?? failure.project.uid,
        projectUid: failure.project.uid,
        environmentName: failure.environment?.name ?? failure.envName,
        environmentUid: failure.environment?.uid,
        deploymentUid: failure.deployment?.uid,
        status: failure.status,
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

  private async projectType(request: CreateRequest): Promise<ProjectTypeChoice> {
    const supplied = await this.need('type', request.type, () =>
      askChoice(
        this.services.ux,
        'Project type',
        PROJECT_TYPE_CHOICES.map((value) => ({ name: value, value })),
      ),
    );

    return projectTypeChoiceOf(supplied);
  }

  private async selectGitSource(request: CreateRequest): Promise<SourceSelection> {
    const namespace = await this.need('namespace', request.namespace, () =>
      askNamespace(this.services, request.org),
    );
    const repository = await this.repository(request, namespace);
    const repoName = repositoryLabel(repository);
    const branch = await this.need('branch', request.branch, () =>
      askBranch(
        this.services,
        { org: request.org, provider: GIT_PROVIDER_GITHUB, namespace, repoName },
        repository.defaultBranch,
      ),
    );
    const detected = await this.services.api.projects.gitFramework({
      org: request.org,
      provider: GIT_PROVIDER_GITHUB,
      repoName,
      branchName: branch,
      namespace,
    });

    return { detected, repository, namespace, branch };
  }

  private async repository(request: CreateRequest, namespace: string): Promise<GitRepository> {
    if (request.repo === undefined) {
      return askRepository(this.services, { org: request.org, provider: GIT_PROVIDER_GITHUB, namespace });
    }

    const page = await this.services.api.git.repositories({
      org: request.org,
      provider: GIT_PROVIDER_GITHUB,
      namespace,
      search: request.repo,
      limit: 100,
      skip: 0,
    });
    const match = page.repositories.find(
      (repository) => repositoryLabel(repository) === request.repo || repository.name === request.repo,
    );

    if (match === undefined) {
      throw new UsageError(`No repository named "${request.repo}" was found under "${namespace}".`);
    }

    return match;
  }

  private async selectUploadSource(request: CreateRequest): Promise<SourceSelection> {
    const archive = archiveDirectory(request.dataDir);
    const signed = await this.services.api.projects.signedUploadUrl({ org: request.org });

    this.services.ux.print(`Uploading ${archive.entries.length} files from ${request.dataDir}`);
    await uploadArchive(signed, archive.buffer);

    const detected = await this.services.api.projects.fileFramework({
      org: request.org,
      uploadUid: signed.uploadUid,
    });

    return { detected, uploadUid: signed.uploadUid };
  }

  private async selectFramework(request: CreateRequest, detected: DetectedFramework): Promise<FrameworkPreset> {
    if (request.framework !== undefined) {
      return frameworkPresetOf(request.framework);
    }

    if (!this.services.isTTY) {
      throw new MissingInputError('framework');
    }

    const suggested = detected.framework === undefined ? undefined : frameworkPresetOf(detected.framework);

    return frameworkPresetOf(
      await askChoice(
        this.services.ux,
        'Framework preset',
        FRAMEWORK_CHOICES.map((label) => ({ name: label, value: label })),
        suggested,
      ),
    );
  }

  private async serverCommand(
    request: CreateRequest,
    framework: FrameworkPreset,
    detected: DetectedFramework,
  ): Promise<string | undefined> {
    if (!SERVER_COMMAND_FRAMEWORKS.includes(framework)) {
      return undefined;
    }

    if (request.serverCmd !== undefined) {
      return request.serverCmd;
    }

    return this.services.isTTY
      ? askText(this.services.ux, 'Server command', detected.serverCommand)
      : undefined;
  }

  private async streaming(request: CreateRequest): Promise<boolean> {
    const mode = await this.need('res-mode', request.resMode, () =>
      askChoice(
        this.services.ux,
        'Response mode',
        RESPONSE_MODES.map((value) => ({ name: value, value })),
        RESPONSE_MODES[0],
      ),
    );

    return mode === RESPONSE_MODES[1];
  }

  private async need(flag: string, supplied: string | undefined, ask: () => Promise<string>): Promise<string> {
    if (supplied !== undefined) {
      return supplied;
    }

    if (!this.services.isTTY) {
      throw new MissingInputError(flag);
    }

    return ask();
  }
}
