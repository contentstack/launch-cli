import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { Progress } from '../core/progress';
import { silentProgress, terminalProgress } from '../core/progress';
import { connectedAccountsUrl } from '../core/region';
import type { ServiceContext } from '../core/service-context';
import { asSentence, messageOf } from '../core/values';
import { GitConnectionMissingError, isMissingGitConnection } from '../git/git.errors';
import { gitConnectionIdentifiedLine, gitConnectionLines, repositoryLabel } from '../git/git.presenter';
import { askBranch, findRepository, repositorySearchTerm } from '../git/git.prompt';
import type { LocalGitHubRepository } from '../git/local-repository';
import { detectGitHubRepository } from '../git/local-repository';
import type { GitNamespacesPage, GitRepository } from '../git/types';
import { GIT_PROVIDER_GITHUB } from '../git/types';
import { LaunchApiError } from '../transport/errors';
import { archiveDirectory } from './project.archive';
import { needInput } from './project.inputs';
import { PREPARING_ARCHIVE } from './project.presenter';
import { refuseArchiveOutsideLimits, uploadArchive } from './project.upload';
import type { CreateRequest, DetectedFramework, SignedUploadUrl } from './types';

export const UPLOAD_PROGRESS_LABEL = 'Uploading project.zip';
const GIT_NAMESPACE_PAGE_SIZE = 100;

export interface SourceSelection {
  detected: DetectedFramework;
  repository?: GitRepository;
  namespace?: string;
  branch?: string;
  uploadUid?: string;
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
        `No GitHub repository was found in ${request.dataDir}. Run this command from a GitHub working copy, ` +
          'or pass --data-dir with the folder holding one.',
      );
    }

    return local;
  }

  async selectGitSource(request: CreateRequest, local: LocalGitHubRepository): Promise<SourceSelection> {
    const namespace = local.namespace;
    const repository = await this.detectedRepository(request, local);
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
  async requireGitConnection(org: string): Promise<void> {
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

  async selectUploadSource(request: CreateRequest): Promise<SourceSelection> {
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

  private progress(): Progress {
    return this.services.outputIsTTY === true ? terminalProgress(UPLOAD_PROGRESS_LABEL) : silentProgress;
  }
}
