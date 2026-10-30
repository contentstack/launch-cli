import { UsageError } from '../core/errors';
import type { Choice } from '../core/prompt';
import { askOption } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { withoutControlCharacters } from '../core/values';
import type { DeploymentScope } from './deployments.api';

const SHORT_SHA_LENGTH = 7;

interface ListedCommit {
  sha?: string;
  shortSha?: string;
  message?: string;
}

const NO_TERMINAL = 'Choosing a commit needs an interactive terminal. Pass --commit <sha> instead.';

const NO_COMMITS = 'No commits are available to choose from. Pass --commit <sha> instead.';

export function commitChoice(commit: ListedCommit & { sha: string }): Choice {
  const listed = withoutControlCharacters(commit.shortSha ?? '').trim();
  const short = listed === '' ? withoutControlCharacters(commit.sha.slice(0, SHORT_SHA_LENGTH)).trim() : listed;
  const subject = withoutControlCharacters((commit.message ?? '').split(/\r\n|[\n\r]/)[0]).trim();

  return { name: subject === '' ? short : `${short}  ${subject}`, value: commit.sha };
}

export async function promptForCommit(deps: ServiceContext, scope: DeploymentScope): Promise<string> {
  if (!deps.isTTY) {
    throw new UsageError(NO_TERMINAL);
  }

  const commits = await deps.api.environments.commits(scope);
  const usable = commits.filter(
    (commit): commit is ListedCommit & { sha: string } => typeof commit.sha === 'string' && commit.sha.trim() !== '',
  );

  if (usable.length === 0) {
    throw new UsageError(NO_COMMITS);
  }

  return askOption(deps.ux, 'Choose a commit for deployment', usable.map(commitChoice));
}
