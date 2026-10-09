import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import { connectedAccountsUrl } from '../core/region';
import type { ServiceContext } from '../core/service-context';
import { asSentence, messageOf } from '../core/values';
import {
  GitConnectionMissingError,
  GitNamespaceNotConnectedError,
  isMissingGitConnection,
} from '../git/git.errors';
import {
  gitConnectionIdentifiedLine,
  gitConnectionLines,
  localRepositoryLine,
  namespaceNotConnectedLines,
  repositoryLabel,
} from '../git/git.presenter';
import { askBranch, findRepository, repositorySearchTerm } from '../git/git.prompt';
import type { LocalGitHubRepository } from '../git/local-repository';
import { detectGitHubRepository } from '../git/local-repository';
import type { GitNamespacesPage, GitRepository } from '../git/types';
import { GIT_PROVIDER_GITHUB } from '../git/types';
import { LaunchApiError } from '../transport/errors';
import { needInput } from './project.inputs';
import { FolderUploader } from '../uploads/upload.folder';
import type { EnvironmentSource } from '../environments/types';
import type { CreateRequest } from './types';

const GIT_NAMESPACE_PAGE_SIZE = 100;

export interface SourceSelection extends EnvironmentSource {
  repository?: GitRepository;
  namespace?: string;
}

/**
 * GitHub account names ignore case, the remote carries whatever was typed at clone time, and the
 * service matches a connection's namespace exactly - so the spelling the connection was stored under
 * is the one every lookup has to use, or a lowercase clone url of a connected account is refused.
 */
function connectedSpelling(namespace: string, connected: string[] | undefined): string {
  const wanted = namespace.toLowerCase();

  return connected?.find((name) => name.toLowerCase() === wanted) ?? namespace;
}

function unreachableRepository(request: CreateRequest, local: LocalGitHubRepository, reason: string): string {
  return (
    `The GitHub repository "${local.repoName}" checked out in ${request.dataDir} is not available to this ` +
    `organization's connected GitHub account: ${reason} ` +
    'Connect it in the Launch app, or pass --data-dir with a folder whose repository is connected.'
  );
}

export class ProjectSource {
  constructor(private readonly services: ServiceContext) {}

  localRepository(request: CreateRequest): LocalGitHubRepository {
    const local = detectGitHubRepository(request.dataDir);

    if (local === undefined) {
      throw new UsageError(
        `No GitHub repository was found in ${request.dataDir} or any folder above it. Run this command inside a ` +
          'working copy of a GitHub repository, or pass --data-dir with one.',
      );
    }

    this.services.ux.print(localRepositoryLine(local.repoName, local.root, this.services.outputIsTTY === true));

    return local;
  }

  async selectGitSource(
    request: CreateRequest,
    local: LocalGitHubRepository,
    connected: string[] | undefined,
  ): Promise<SourceSelection> {
    const namespace = connectedSpelling(local.namespace, connected);
    const repository = await this.detectedRepository(request, local, namespace, connected);
    const repoName = repositoryLabel(repository);
    const branch = await needInput(this.services, 'branch', request.branch, () =>
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
  async requireGitConnection(org: string): Promise<string[] | undefined> {
    let page: GitNamespacesPage;

    try {
      page = await this.services.api.git.namespaces({ org, limit: GIT_NAMESPACE_PAGE_SIZE, skip: 0 });
    } catch (error) {
      if (isMissingGitConnection(error)) {
        throw this.noGitConnection();
      }

      if (error instanceof LaunchApiError) {
        return undefined;
      }

      throw error;
    }

    const connected = page.namespaces
      .filter((namespace) => namespace.provider === GIT_PROVIDER_GITHUB)
      .map((namespace) => namespace.name)
      .filter((name): name is string => Boolean(name));

    if (connected.length === 0) {
      throw this.noGitConnection();
    }

    this.services.ux.print(gitConnectionIdentifiedLine(GIT_PROVIDER_GITHUB, this.services.outputIsTTY === true));

    return connected;
  }

  async selectUploadSource(request: CreateRequest): Promise<SourceSelection> {
    const uploadUid = await new FolderUploader(this.services).upload({ org: request.org }, request.dataDir, [
      request.configPath,
    ]);
    const detected = await this.services.api.projects.fileFramework({ org: request.org, uploadUid });

    return { detected, uploadUid };
  }

  private async detectedRepository(
    request: CreateRequest,
    local: LocalGitHubRepository,
    namespace: string,
    connected: string[] | undefined,
  ): Promise<GitRepository> {
    const match = await this.reachableRepository(request, local, namespace, connected);

    if (match === undefined) {
      throw new UsageError(unreachableRepository(request, local, 'no repository with that name was found.'));
    }

    return match;
  }

  private async reachableRepository(
    request: CreateRequest,
    local: LocalGitHubRepository,
    namespace: string,
    connected: string[] | undefined,
  ): Promise<GitRepository | undefined> {
    try {
      const page = await this.services.api.git.repositories({
        org: request.org,
        provider: GIT_PROVIDER_GITHUB,
        namespace,
        search: repositorySearchTerm(local.repoName),
        limit: PICKER_PAGE_SIZE,
        skip: 0,
      });

      return findRepository(page.repositories, local.repoName);
    } catch (error) {
      if (isMissingGitConnection(error)) {
        throw this.notConnectedTo(local, connected) ?? this.noGitConnection();
      }

      if (error instanceof LaunchApiError) {
        throw new UsageError(unreachableRepository(request, local, asSentence(messageOf(error))));
      }

      throw error;
    }
  }

  /**
   * The service answers "no user connection found" both when the user has connected nothing and when
   * they have connected accounts that simply do not include this repository's owner, which is the
   * common case for a repository someone else owns. The namespaces fetched before any prompt tell the
   * two apart, so the second is named for what it is rather than reported as the first. A list that
   * never arrived says nothing either way, and V1's message stands.
   */
  private notConnectedTo(
    local: LocalGitHubRepository,
    connected: string[] | undefined,
  ): GitNamespaceNotConnectedError | undefined {
    const owner = local.namespace.toLowerCase();

    if (connected === undefined || connected.some((name) => name.toLowerCase() === owner)) {
      return undefined;
    }

    const appUrl = this.services.launchAppUrl;
    const connectUrl = appUrl === undefined ? undefined : connectedAccountsUrl(appUrl);

    for (const line of namespaceNotConnectedLines(
      local.namespace,
      connected,
      connectUrl,
      this.services.outputIsTTY === true,
    )) {
      this.services.ux.print(line);
    }

    return new GitNamespaceNotConnectedError(local.namespace, connected);
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
}
