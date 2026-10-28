import { UsageError } from '../core/errors';
import type { Choice } from '../core/prompt';
import { askOption } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { DeploymentScope } from './deployments.api';

const SHORT_SHA_LENGTH = 7;

interface ListedCommit {
  sha?: string;
  shortSha?: string;
  message?: string;
}

const NEEDS_COMMIT = '--commit needs a commit hash to deploy here. Pass --commit <sha>.';
export function commitChoice(commit: ListedCommit & { sha: string }): Choice {
  const short = commit.shortSha?.trim() ? commit.shortSha : commit.sha.slice(0, SHORT_SHA_LENGTH);
  const subject = (commit.message ?? '').split('\n')[0].trim();

  return { name: subject === '' ? short : `${short}  ${subject}`, value: commit.sha };
}

export async function promptForCommit(deps: ServiceContext, scope: DeploymentScope): Promise<string> {
  if (!deps.isTTY) {
    throw new UsageError(NEEDS_COMMIT);
  }

  const commits = await deps.api.environments.commits(scope);
  const usable = commits.filter(
    (commit): commit is ListedCommit & { sha: string } => typeof commit.sha === 'string' && commit.sha.trim() !== '',
  );

  if (usable.length === 0) {
    throw new UsageError(NEEDS_COMMIT);
  }

  return askOption(deps.ux, 'Choose a commit to deploy', usable.map(commitChoice));
}
