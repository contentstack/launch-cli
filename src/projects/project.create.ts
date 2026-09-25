import { MissingInputError, UsageError } from '../core/errors';
import { ProjectConfig, ProjectConfigStore } from '../core/project-config';
import { renderDetail } from '../core/render';
import { requireValueOf } from '../core/rules';
import type { ServiceContext } from '../core/service-context';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { deploymentUrlOf } from '../deployments/deployment.presenter';
import { WatchTiming, watchDeployment } from '../deployments/deployment.watcher';
import type { Deployment } from '../deployments/types';
import {
  FRAMEWORK_CHOICES,
  FRAMEWORK_PRESET_BY_LABEL,
  OUTPUT_DIRECTORY_BY_FRAMEWORK,
  RESPONSE_MODES,
  ResponseMode,
  ToggleValue,
  frameworkPresetOf,
} from '../environments/environment.inputs';
import type { CreateEnvironmentInput, Environment, FrameworkPreset } from '../environments/types';
import { SERVER_COMMAND_FRAMEWORKS } from '../environments/types';
import { GIT_PROVIDER_GITHUB, GitRepository } from '../git/types';
import { archiveDirectory } from './project.archive';
import {
  askBranch,
  askChoice,
  askNamespace,
  askOptionalText,
  askRepository,
  askText,
  findRepository,
  repositoryLabel,
  repositorySearchTerm,
} from './project.create.prompt';
import { deploymentFailureMessage, projectCreatedFields } from './project.presenter';
import {
  GIT_ONLY_FLAGS,
  PROJECT_TYPE_BY_CHOICE,
  ProjectTypeChoice,
  askProjectType,
  projectTypeChoiceOf,
} from './project.inputs';
import { uploadArchive } from './project.upload';
import type { CreateProjectInput, DetectedFramework, IdentifiedProject } from './types';

export { DEPLOYMENT_WAIT_TIMEOUT_MS, defaultWatchTiming } from '../deployments/deployment.watcher';
export { serverCommandFrameworkGate } from '../environments/environment.inputs';

export const NO_DEPLOYMENT_STATUS = 'NONE';
export const FIRST_LOOKUP_ATTEMPTS = 3;
export const CREATE_PROMPT_REMEDIES = { config: false, prompt: true };

export function reasonOf(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim();

  return text.endsWith('.') ? text : `${text}.`;
}

export interface CreateRequest {
  org: string;
  dataDir: string;
  configPath: string;
  type?: ProjectTypeChoice;
  name?: string;
  description?: string;
  envName?: string;
  namespace?: string;
  repo?: string;
  branch?: string;
  framework?: FrameworkPreset;
  buildCmd?: string;
  outputDir?: string;
  serverCmd?: string;
  resMode?: ResponseMode;
  autoDeploy?: ToggleValue;
  csAuth?: ToggleValue;
}

interface Survivors {
  org: string;
  project: IdentifiedProject;
  envName: string;
  environment?: Environment;
  deployment?: Deployment;
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

export function frameworkLabelOf(detected: unknown): string | undefined {
  if (typeof detected !== 'string') {
    return undefined;
  }

  const wanted = detected.trim().toLowerCase();

  return FRAMEWORK_CHOICES.find((label) => label.toLowerCase() === wanted);
}

export class ProjectCreator {
  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {}

  async create(request: CreateRequest): Promise<void> {
    this.refuseLinkedFolder(request);

    const choice = await this.projectType(request);
    this.refuseGitFlagsOffGitHub(request, choice);
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
      buildCommand: await this.buildCommand(request, source.detected),
      outputDirectory: await this.outputDirectory(request, framework, source.detected),
      serverCommand: await this.serverCommand(request, framework, source.detected),
      frameworkPreset: framework,
      environmentVariables: emptyEnvironmentVariables(),
      isStreamingEnabled: await this.streaming(request),
    };

    if (request.autoDeploy !== undefined) {
      environment.autoDeployOnPush = request.autoDeploy === 'enable';
    }

    if (request.csAuth !== undefined) {
      environment.isContentstackAuthenticationEnabled = request.csAuth === 'enable';
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

  private remember(request: CreateRequest, project: IdentifiedProject): void {
    const path = request.configPath;

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

  private async follow(org: string, project: IdentifiedProject, envName: string): Promise<void> {
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
        logs: (after) => this.services.api.deploymentLogs.after({ ...scope, timestamp: after }),
        poll: () => this.services.api.deployments.get(scope),
      }),
    );

    if (outcome.kind === 'success') {
      renderDetail(this.services.ux, projectCreatedFields(project, this.siteUrl(outcome.deployment, environment)));
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

  private async explaining<T>(survivors: Survivors, step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      throw this.unsuccessful({ ...survivors, status: NO_DEPLOYMENT_STATUS, reason: reasonOf(error) });
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

  private async projectType(request: CreateRequest): Promise<ProjectTypeChoice> {
    if (request.type !== undefined) {
      return request.type;
    }

    return projectTypeChoiceOf(await this.need('type', undefined, () => askProjectType(this.services.ux)));
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
      search: repositorySearchTerm(request.repo),
      limit: 100,
      skip: 0,
    });
    const match = findRepository(page.repositories, request.repo);

    if (match === undefined) {
      throw new UsageError(`No repository named "${request.repo}" was found under "${namespace}".`);
    }

    return match;
  }

  private async selectUploadSource(request: CreateRequest): Promise<SourceSelection> {
    const archive = archiveDirectory(request.dataDir, [request.configPath]);
    const signed = await this.services.api.projects.signedUploadUrl({ org: request.org });

    if (archive.skippedLinks.length > 0) {
      this.services.ux.print(
        `Skipping ${archive.skippedLinks.length} symbolic link(s), which are never uploaded: ` +
          archive.skippedLinks.join(', '),
      );
    }

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
      return request.framework;
    }

    if (this.services.isTTY) {
      return frameworkPresetOf(
        await askChoice(
          this.services.ux,
          'Framework preset',
          FRAMEWORK_CHOICES.map((label) => ({ name: label, value: label })),
          frameworkLabelOf(detected.framework),
        ),
      );
    }

    const label = frameworkLabelOf(detected.framework);

    if (label === undefined) {
      throw new MissingInputError('framework', CREATE_PROMPT_REMEDIES);
    }

    const preset = FRAMEWORK_PRESET_BY_LABEL[label.toLowerCase()];
    this.services.ux.print(`Using the detected framework ${preset}. Pass --framework to choose another.`);

    return preset;
  }

  private async serverCommand(
    request: CreateRequest,
    framework: FrameworkPreset,
    detected: DetectedFramework,
  ): Promise<string | undefined> {
    if (request.serverCmd !== undefined) {
      requireValueOf('server-cmd', 'framework', SERVER_COMMAND_FRAMEWORKS, framework);

      return request.serverCmd;
    }

    if (!SERVER_COMMAND_FRAMEWORKS.includes(framework)) {
      return undefined;
    }

    if (this.services.isTTY) {
      return askOptionalText(this.services.ux, 'Server command', detected.serverCommand);
    }

    return this.detectedValue(detected.serverCommand, 'server command', '--server-cmd');
  }

  private async buildCommand(request: CreateRequest, detected: DetectedFramework): Promise<string | undefined> {
    if (request.buildCmd !== undefined) {
      return request.buildCmd;
    }

    if (this.services.isTTY) {
      return askOptionalText(this.services.ux, 'Build command', detected.buildCommand);
    }

    return this.detectedValue(detected.buildCommand, 'build command', '--build-cmd');
  }

  private async outputDirectory(
    request: CreateRequest,
    framework: FrameworkPreset,
    detected: DetectedFramework,
  ): Promise<string> {
    if (request.outputDir !== undefined) {
      return request.outputDir;
    }

    const fallback = OUTPUT_DIRECTORY_BY_FRAMEWORK[framework];

    if (this.services.isTTY) {
      return askText(this.services.ux, 'Output directory', detected.outputDirectory ?? fallback);
    }

    const found = this.detectedValue(detected.outputDirectory, 'output directory', '--output-dir');

    if (found !== undefined) {
      return found;
    }

    this.services.ux.print(
      `Using the default output directory "${fallback}" for ${framework}. Pass --output-dir to change it.`,
    );

    return fallback;
  }

  private detectedValue(value: string | undefined, noun: string, flag: string): string | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }

    this.services.ux.print(`Using the detected ${noun} "${value}". Pass ${flag} to change it.`);

    return value;
  }

  private refuseLinkedFolder(request: CreateRequest): void {
    const linked = new ProjectConfigStore(request.configPath).linkedProject();

    if (linked === undefined) {
      return;
    }

    const named = linked.name ? `"${linked.name}" (${linked.uid})` : `${linked.uid}`;

    throw new UsageError(
      `This folder is already linked to the project ${named} in ${request.configPath}. ` +
        'To create a new project, remove that file or pass --config with a different path.',
    );
  }

  private refuseGitFlagsOffGitHub(request: CreateRequest, choice: ProjectTypeChoice): void {
    const supplied: Record<(typeof GIT_ONLY_FLAGS)[number], string | undefined> = {
      branch: request.branch,
      namespace: request.namespace,
      repo: request.repo,
    };

    for (const flag of GIT_ONLY_FLAGS) {
      if (supplied[flag] !== undefined) {
        requireValueOf(flag, 'type', ['GitHub'], choice);
      }
    }
  }

  private async streaming(request: CreateRequest): Promise<boolean> {
    if (request.resMode !== undefined) {
      return request.resMode === ('streaming' satisfies ResponseMode);
    }

    if (this.services.isTTY) {
      const mode = await askChoice(
        this.services.ux,
        'Response mode',
        RESPONSE_MODES.map((value) => ({ name: value, value })),
        RESPONSE_MODES[0],
      );

      return mode === ('streaming' satisfies ResponseMode);
    }

    this.services.ux.print('Using the buffered response mode. Pass --res-mode streaming to stream responses.');

    return false;
  }

  private async need<T extends string | undefined>(
    flag: string,
    supplied: string | undefined,
    ask: () => Promise<T>,
  ): Promise<string | T> {
    if (supplied !== undefined) {
      return supplied;
    }

    if (!this.services.isTTY) {
      throw new MissingInputError(flag, CREATE_PROMPT_REMEDIES);
    }

    return ask();
  }
}
