import { basename, relative, resolve, sep } from 'node:path';

import { PICKER_PAGE_SIZE } from '../core/constants';
import { LaunchError, MissingInputError, UsageError } from '../core/errors';
import type { ProjectConfig } from '../core/project-config';
import { ProjectConfigStore } from '../core/project-config';
import { requireValueOf } from '../core/rules';
import type { ServiceContext } from '../core/service-context';
import type { Loader } from '../core/loader';
import { silentLoader, terminalLoader } from '../core/loader';
import type { Progress } from '../core/progress';
import { silentProgress, terminalProgress } from '../core/progress';
import { DeploymentUnsuccessfulError } from '../deployments/deployment.errors';
import { deploymentUrlOf } from '../deployments/deployment.presenter';
import type { WatchTiming } from '../deployments/deployment.watcher';
import { watchDeployment } from '../deployments/deployment.watcher';
import type { Deployment } from '../deployments/types';
import type { ResponseMode, ToggleValue } from '../environments/environment.inputs';
import {
  ENVIRONMENT_NAME_MAX_LENGTH,
  RESPONSE_MODES,
  TOGGLE_VALUES,
  frameworkPresetOf,
} from '../environments/environment.inputs';
import type { FrameworkPreset } from '../environments/frameworks';
import {
  FRAMEWORK_CHOICES,
  FRAMEWORK_PRESET_BY_LABEL,
  OUTPUT_DIRECTORY_BY_FRAMEWORK,
  SERVER_COMMAND_FRAMEWORKS,
} from '../environments/frameworks';
import type { CreateEnvironmentInput, Environment } from '../environments/types';
import { GitConnectionMissingError, isMissingGitConnection } from '../git/git.errors';
import { gitConnectionIdentifiedLine, gitConnectionLines, repositoryLabel } from '../git/git.presenter';
import type { LocalGitHubRepository } from '../git/local-repository';
import { detectGitHubRepository } from '../git/local-repository';
import type { GitNamespacesPage, GitRepository } from '../git/types';
import { GIT_PROVIDER_GITHUB } from '../git/types';
import { connectedAccountsUrl } from '../core/region';
import { LaunchApiError } from '../transport/errors';
import { archiveDirectory } from './project.archive';
import { askOption, askOptionalText, askText } from '../core/prompt';
import { asSentence, messageOf } from '../core/values';
import { askBranch, findRepository, repositorySearchTerm } from '../git/git.prompt';
import {
  PREPARING_ARCHIVE,
  RENAME_PROJECT_QUESTION,
  deploymentFailureMessage,
  deploymentUrlLine,
  createFailureCauseLine,
  duplicateProjectNameLine,
  gitOnlyFlagLine,
  projectCreatedLine,
  projectCreationFailedLine,
  renameAndRerunLine,
  renameRetryLimitLine,
} from './project.presenter';
import type { GitOnlyFlag, ProjectTypeChoice } from './project.inputs';
import {
  GIT_ONLY_FLAGS,
  PROJECT_TYPE_BY_CHOICE,
  askProjectType,
  projectTypeChoiceOf,
} from './project.inputs';
import { DuplicateProjectNameError, ProjectCreateFailedError } from './project.errors';
import { refuseArchiveOutsideLimits, uploadArchive } from './project.upload';
import type { CreateProjectInput, DetectedFramework, IdentifiedProject, SignedUploadUrl } from './types';
import { PROJECT_NAME_MAX_LENGTH } from './types';

export const NO_DEPLOYMENT_STATUS = 'NONE';
export const DEFAULT_ENVIRONMENT_NAME = 'Default';
export const FIRST_LOOKUP_ATTEMPTS = 3;
export const CREATE_PROMPT_REMEDIES = { config: false, prompt: true };
export const UPLOAD_PROGRESS_LABEL = 'Uploading project.zip';
export const DUPLICATE_PROJECT_NAME_CODE = 'launch.PROJECT.DUPLICATE_NAME';
export const PROJECT_RENAME_ATTEMPTS = 3;
export const SITE_OPEN_DELAY_MS = 6000;
export const GIT_NAMESPACE_PAGE_SIZE = 100;

export interface CreateRequest {
  org: string;
  dataDir: string;
  configPath: string;
  type?: ProjectTypeChoice;
  name?: string;
  description?: string;
  envName?: string;
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

function shownPath(path: string): string {
  const absolute = resolve(path);
  const fromHere = relative(process.cwd(), absolute);

  return fromHere.split(sep)[0] === '..' ? absolute : fromHere;
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

function unreachableRepository(request: CreateRequest, local: LocalGitHubRepository, reason: string): string {
  return (
    `The GitHub repository "${local.repoName}" checked out in ${request.dataDir} is not available to this ` +
    `organization's connected GitHub account: ${reason} ` +
    'Connect it in the Launch app, or pass --data-dir with a folder whose repository is connected.'
  );
}

export class ProjectCreator {
  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {}

  async create(request: CreateRequest): Promise<void> {
    this.refuseLinkedFolder(request);

    const choice = await this.projectType(request);
    this.warnGitFlagsOffGitHub(request, choice);

    if (choice === 'GitHub') {
      await this.requireGitConnection(request.org);
    }

    const local = choice === 'GitHub' ? this.localRepository(request) : undefined;
    const autoDeploy = choice === 'GitHub' ? request.autoDeploy : undefined;
    const upload = choice === 'GitHub' ? undefined : await this.selectUploadSource(request);
    const suggestedName = this.suggestedName(request, local);
    const name = await this.need('name', request.name, () =>
      askText(this.services.ux, 'Project name', suggestedName, PROJECT_NAME_MAX_LENGTH),
    );
    const envName = await this.need('env-name', request.envName, () =>
      askText(this.services.ux, 'Environment name', DEFAULT_ENVIRONMENT_NAME, ENVIRONMENT_NAME_MAX_LENGTH),
    );
    const source = upload ?? (await this.selectGitSource(request, local as LocalGitHubRepository));
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

    if (autoDeploy !== undefined) {
      environment.autoDeployOnPush = autoDeploy === 'enable';
    }

    const csAuth = await this.contentstackAuthentication(request);

    if (csAuth !== undefined) {
      environment.isContentstackAuthenticationEnabled = csAuth === 'enable';
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

    const project = await this.createProject(request.org, input, suggestedName);

    this.services.ux.print(projectCreatedLine(this.services.outputIsTTY === true));
    this.remember(request, project);

    await this.follow(request.org, project, envName);
  }

  /**
   * A taken name is the one create failure the user can fix on the spot, so it is reported in V1's words
   * and, in a terminal, a new name is offered and the same request sent again - the upload included, so
   * nothing is zipped twice. V1 allowed three renames. Declining, running out of renames, or having no
   * terminal to ask on all exit 1 as V1 did; the last says how to fix it, where V1 hung on its prompt.
   */
  private async createProject(
    org: string,
    input: CreateProjectInput,
    suggestedName: string,
    renames = 0,
  ): Promise<IdentifiedProject> {
    try {
      return await this.services.api.projects.create({ org, input });
    } catch (error) {
      if (!(error instanceof LaunchError)) {
        throw error;
      }

      const colour = this.services.outputIsTTY === true;

      this.services.ux.print(projectCreationFailedLine(colour));

      if (!(error instanceof LaunchApiError) || error.code !== DUPLICATE_PROJECT_NAME_CODE) {
        this.services.ux.print(createFailureCauseLine(error, colour));
        throw new ProjectCreateFailedError(error);
      }

      this.services.ux.print(duplicateProjectNameLine(colour));

      if (this.services.isTTY) {
        return this.askToRename(org, input, suggestedName, renames, colour);
      }

      this.services.ux.print(renameAndRerunLine(colour));
      throw new DuplicateProjectNameError();
    }
  }

  private async askToRename(
    org: string,
    input: CreateProjectInput,
    suggestedName: string,
    renames: number,
    colour: boolean,
  ): Promise<IdentifiedProject> {
    if (renames >= PROJECT_RENAME_ATTEMPTS) {
      this.services.ux.print(renameRetryLimitLine(colour));
      throw new DuplicateProjectNameError();
    }

    const rename = await this.services.ux.inquire<boolean>({
      type: 'confirm',
      name: 'confirm',
      message: RENAME_PROJECT_QUESTION,
      default: true,
    });

    if (rename !== true) {
      throw new DuplicateProjectNameError();
    }

    const name = await askText(this.services.ux, 'Project name', suggestedName, PROJECT_NAME_MAX_LENGTH);

    return this.createProject(org, { ...input, name }, suggestedName, renames + 1);
  }

  private remember(request: CreateRequest, project: IdentifiedProject): void {
    const path = request.configPath;

    const config: ProjectConfig = { uid: project.uid, organizationUid: request.org };

    try {
      new ProjectConfigStore(path).save(config);
    } catch (error) {
      const reason = messageOf(error);

      this.services.ux.print(
        `Could not record this project in ${path}: ${reason} ` +
          `Pass --org ${request.org} --project ${project.uid} explicitly when you run Launch commands ` +
          'in this folder.',
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

  private async projectType(request: CreateRequest): Promise<ProjectTypeChoice> {
    if (request.type !== undefined) {
      return request.type;
    }

    return projectTypeChoiceOf(await this.need('type', undefined, () => askProjectType(this.services.ux)));
  }

  private localRepository(request: CreateRequest): LocalGitHubRepository {
    const local = detectGitHubRepository(request.dataDir);

    if (local === undefined) {
      throw new UsageError(
        `No GitHub repository was found in ${request.dataDir}. Run this command from a GitHub working copy, ` +
          'or pass --data-dir with the folder holding one.',
      );
    }

    return local;
  }

  /**
   * V1 offered the repository's name for a GitHub project and the folder's name for an upload, both as
   * the project name prompt's initial value and again when a taken name was renamed.
   */
  private suggestedName(request: CreateRequest, local: LocalGitHubRepository | undefined): string {
    return local === undefined ? basename(resolve(request.dataDir)) : repositorySearchTerm(local.repoName);
  }

  private async selectGitSource(request: CreateRequest, local: LocalGitHubRepository): Promise<SourceSelection> {
    const namespace = local.namespace;
    const repository = await this.detectedRepository(request, local);
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

  private async detectedRepository(request: CreateRequest, local: LocalGitHubRepository): Promise<GitRepository> {
    const match = await this.reachableRepository(request, local);

    if (match === undefined) {
      throw new UsageError(unreachableRepository(request, local, 'no repository with that name was found.'));
    }

    return match;
  }

  private async reachableRepository(
    request: CreateRequest,
    local: LocalGitHubRepository,
  ): Promise<GitRepository | undefined> {
    try {
      const page = await this.services.api.git.repositories({
        org: request.org,
        provider: GIT_PROVIDER_GITHUB,
        namespace: local.namespace,
        search: repositorySearchTerm(local.repoName),
        limit: PICKER_PAGE_SIZE,
        skip: 0,
      });

      return findRepository(page.repositories, local.repoName);
    } catch (error) {
      if (isMissingGitConnection(error)) {
        throw this.noGitConnection();
      }

      if (error instanceof LaunchApiError) {
        throw new UsageError(unreachableRepository(request, local, asSentence(messageOf(error))));
      }

      throw error;
    }
  }

  /**
   * V1 looked for the user's GitHub connection before asking anything about the project, said so in
   * green when it found one, and sent the user to the connected-accounts page when it did not, so a
   * missing connection never cost them a round of prompts first.
   *
   * `GET /git-namespaces` also asks every external git provider of the organization for its namespaces
   * and fails whole when any one of them does, so any other answer the API refuses with proves nothing
   * about GitHub: create carries on unannounced and the GitHub-only repository lookup decides, as it did
   * before this check existed. Only a failure that is not an API answer, such as an expired session,
   * stops the command here.
   */
  private async requireGitConnection(org: string): Promise<void> {
    let page: GitNamespacesPage;

    try {
      page = await this.services.api.git.namespaces({ org, limit: GIT_NAMESPACE_PAGE_SIZE, skip: 0 });
    } catch (error) {
      if (isMissingGitConnection(error)) {
        throw this.noGitConnection();
      }

      if (error instanceof LaunchApiError) {
        return;
      }

      throw error;
    }

    if (!page.namespaces.some((namespace) => namespace.provider === GIT_PROVIDER_GITHUB && Boolean(namespace.name))) {
      throw this.noGitConnection();
    }

    this.services.ux.print(gitConnectionIdentifiedLine(GIT_PROVIDER_GITHUB, this.services.outputIsTTY === true));
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

  /**
   * V1 did not merely report a missing GitHub connection: it printed the connected-accounts URL
   * and opened it, because the fix is a page in the Launch app and nothing the CLI can do.
   */
  private noGitConnection(): GitConnectionMissingError {
    const appUrl = this.services.launchAppUrl;
    const connectUrl = appUrl === undefined ? undefined : connectedAccountsUrl(appUrl);

    for (const line of gitConnectionLines(GIT_PROVIDER_GITHUB, connectUrl, this.services.outputIsTTY === true)) {
      this.services.ux.print(line);
    }

    if (connectUrl !== undefined) {
      this.services.openUrl?.(connectUrl);
    }

    return new GitConnectionMissingError(GIT_PROVIDER_GITHUB, connectUrl);
  }

  private async selectUploadSource(request: CreateRequest): Promise<SourceSelection> {
    this.services.ux.print(PREPARING_ARCHIVE);
    const archive = archiveDirectory(request.dataDir, [request.configPath]);
    refuseArchiveOutsideLimits(archive.buffer.length);

    if (archive.skippedLinks.length > 0) {
      this.services.ux.print(
        `Skipping ${archive.skippedLinks.length} symbolic link(s), which are never uploaded: ` +
          archive.skippedLinks.join(', '),
      );
    }

    const signed = await this.services.api.projects.signedUploadUrl({ org: request.org });
    await this.uploading(signed, archive.buffer);

    const detected = await this.services.api.projects.fileFramework({
      org: request.org,
      uploadUid: signed.uploadUid,
    });

    return { detected, uploadUid: signed.uploadUid };
  }

  private async uploading(signed: SignedUploadUrl, body: Buffer): Promise<void> {
    const progress = this.progress();

    try {
      await uploadArchive(signed, body, {
        onProgress: (sent, total) => {
          progress.start(total);
          progress.advance(sent);
        },
      });
    } finally {
      progress.stop();
    }
  }

  private loader(): Loader {
    return this.services.outputIsTTY === true ? terminalLoader() : silentLoader;
  }

  private progress(): Progress {
    return this.services.outputIsTTY === true ? terminalProgress(UPLOAD_PROGRESS_LABEL) : silentProgress;
  }

  private async selectFramework(request: CreateRequest, detected: DetectedFramework): Promise<FrameworkPreset> {
    if (request.framework !== undefined) {
      return request.framework;
    }

    if (this.services.isTTY) {
      return frameworkPresetOf(
        await askOption(
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

    throw new UsageError(
      `This folder already belongs to project ${linked.uid}.\n` +
        `To create a new project, rename or delete ${shownPath(request.configPath)}.`,
    );
  }

  /**
   * A branch and auto-deploy both belong to a git repository, which a FileUpload project has none of.
   * Either one supplied is dropped with a warning naming the flag, so it is never ignored silently.
   */
  private warnGitFlagsOffGitHub(request: CreateRequest, choice: ProjectTypeChoice): void {
    if (choice === 'GitHub') {
      return;
    }

    const supplied: Record<GitOnlyFlag, string | undefined> = {
      branch: request.branch,
      'auto-deploy': request.autoDeploy,
    };

    for (const flag of GIT_ONLY_FLAGS) {
      if (supplied[flag] !== undefined) {
        this.services.ux.print(gitOnlyFlagLine(flag, this.services.outputIsTTY === true));
      }
    }
  }

  private async streaming(request: CreateRequest): Promise<boolean> {
    if (request.resMode !== undefined) {
      return request.resMode === ('streaming' satisfies ResponseMode);
    }

    if (this.services.isTTY) {
      const mode = await askOption(
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

  private async contentstackAuthentication(request: CreateRequest): Promise<string | undefined> {
    if (request.csAuth !== undefined) {
      return request.csAuth;
    }

    if (this.services.isTTY) {
      return askOption(
        this.services.ux,
        'Contentstack Authentication',
        TOGGLE_VALUES.map((value) => ({ name: value, value })),
        'enable' satisfies ToggleValue,
      );
    }

    return undefined;
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
