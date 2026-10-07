import { basename, relative, resolve, sep } from 'node:path';

import { LaunchError, UsageError } from '../core/errors';
import type { ProjectConfig } from '../core/project-config';
import { ProjectConfigStore } from '../core/project-config';
import { askText } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { messageOf } from '../core/values';
import type { WatchTiming } from '../deployments/deployment.watcher';
import type { ResponseMode, ToggleValue } from '../environments/environment.inputs';
import { ENVIRONMENT_NAME_MAX_LENGTH } from '../environments/environment.inputs';
import type { FrameworkPreset } from '../environments/frameworks';
import { repositoryLabel } from '../git/git.presenter';
import { repositorySearchTerm } from '../git/git.prompt';
import type { LocalGitHubRepository } from '../git/local-repository';
import { GIT_PROVIDER_GITHUB } from '../git/types';
import { LaunchApiError } from '../transport/errors';
import { EnvironmentBuilder } from './project.environment';
import { DuplicateProjectNameError, ProjectCreateFailedError } from './project.errors';
import { DeploymentFollower } from './project.follow';
import type { GitOnlyFlag, ProjectTypeChoice } from './project.inputs';
import {
  GIT_ONLY_FLAGS,
  PROJECT_TYPE_BY_CHOICE,
  askProjectType,
  needInput,
  projectTypeChoiceOf,
} from './project.inputs';
import {
  RENAME_PROJECT_QUESTION,
  createFailureCauseLine,
  duplicateProjectNameLine,
  gitOnlyFlagLine,
  projectCreatedLine,
  projectCreationFailedLine,
  renameAndRerunLine,
  renameRetryLimitLine,
} from './project.presenter';
import { ProjectSource } from './project.source';
import type { CreateProjectInput, IdentifiedProject } from './types';
import { PROJECT_NAME_MAX_LENGTH } from './types';

export const DEFAULT_ENVIRONMENT_NAME = 'Default';
export const DUPLICATE_PROJECT_NAME_CODE = 'launch.PROJECT.DUPLICATE_NAME';
export const PROJECT_RENAME_ATTEMPTS = 3;

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

function shownPath(path: string): string {
  const absolute = resolve(path);
  const fromHere = relative(process.cwd(), absolute);

  return fromHere.split(sep)[0] === '..' ? absolute : fromHere;
}

export class ProjectCreator {
  private readonly source: ProjectSource;
  private readonly environments: EnvironmentBuilder;
  private readonly follower: DeploymentFollower;

  constructor(
    private readonly services: ServiceContext,
    private readonly timing: WatchTiming,
  ) {
    this.source = new ProjectSource(services);
    this.environments = new EnvironmentBuilder(services);
    this.follower = new DeploymentFollower(services, this.timing);
  }

  async create(request: CreateRequest): Promise<void> {
    this.refuseLinkedFolder(request);

    const choice = await this.projectType(request);
    this.warnGitFlagsOffGitHub(request, choice);

    if (choice === 'GitHub') {
      await this.source.requireGitConnection(request.org);
    }

    const local = choice === 'GitHub' ? this.source.localRepository(request) : undefined;
    const autoDeploy = choice === 'GitHub' ? request.autoDeploy : undefined;
    const upload = choice === 'GitHub' ? undefined : await this.source.selectUploadSource(request);
    const suggestedName = this.suggestedName(request, local);
    const name = await needInput(this.services, 'name', request.name, () =>
      askText(this.services.ux, 'Project name', suggestedName, PROJECT_NAME_MAX_LENGTH),
    );
    const envName = await needInput(this.services, 'env-name', request.envName, () =>
      askText(this.services.ux, 'Environment name', DEFAULT_ENVIRONMENT_NAME, ENVIRONMENT_NAME_MAX_LENGTH),
    );
    const source = upload ?? (await this.source.selectGitSource(request, local as LocalGitHubRepository));
    const environment = await this.environments.build(request, envName, source, autoDeploy);

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

    await this.follower.follow(request.org, project, envName);
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

  private async projectType(request: CreateRequest): Promise<ProjectTypeChoice> {
    if (request.type !== undefined) {
      return request.type;
    }

    return projectTypeChoiceOf(
      await needInput(this.services, 'type', undefined, () => askProjectType(this.services.ux)),
    );
  }

  /**
   * V1 offered the repository's name for a GitHub project and the folder's name for an upload, both as
   * the project name prompt's initial value and again when a taken name was renamed.
   */
  private suggestedName(request: CreateRequest, local: LocalGitHubRepository | undefined): string {
    return local === undefined ? basename(resolve(request.dataDir)) : repositorySearchTerm(local.repoName);
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
}
