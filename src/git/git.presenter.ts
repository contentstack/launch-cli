import { styled } from '../core/style';
import type { GitRepository } from './types';

/**
 * V1 drew this through winston, whose colours it inherited: the problem in red under an `error:`
 * label, the way out in green under an `info:` one, and the URL green on its own line so it can be
 * copied whole. It is three lines rather than one because the URL is the answer, not a detail.
 */
export function gitConnectionLines(provider: string, connectUrl: string | undefined, colour: boolean): string[] {
  const lines = [styled(`error: ${provider} connection not found!`, 'red', colour)];

  if (connectUrl === undefined) {
    return lines;
  }

  return [
    ...lines,
    styled(`info: You can connect your ${provider} account to the UI using the following URL:`, 'green', colour),
    styled(connectUrl, 'green', colour),
  ];
}

function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);

  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * The accounts are named because the pair of them is the whole point: a user who reads only that a
 * connection is missing goes and makes the one they already have again, which is what V1 left them
 * doing. The repository's owner is the account that has to be connected, and it may not be theirs
 * to connect, so the line stops short of telling them to go and connect it.
 */
export function namespaceNotConnectedLines(
  namespace: string,
  connected: readonly string[],
  connectUrl: string | undefined,
  colour: boolean,
): string[] {
  const owns = connected.length === 1 ? 'does not own' : 'do not own';
  const manage = connectUrl === undefined ? '' : ` Manage your GitHub connections: ${connectUrl}`;

  return [
    styled(
      `error: You are connected to GitHub as ${quotedList(connected)}, which ${owns} this repository.`,
      'red',
      colour,
    ),
    styled(`info: This repository belongs to "${namespace}".${manage}`, 'green', colour),
  ];
}

export function gitConnectionIdentifiedLine(provider: string, colour: boolean): string {
  return styled(`info: ${provider} connection identified!`, 'green', colour);
}

export function localRepositoryLine(repoName: string, root: string, colour: boolean): string {
  return `Using the GitHub repository ${repoName} from ${styled(root, 'cyan', colour)}.`;
}

export function repositoryLabel(repository: GitRepository): string {
  return repository.fullName || repository.name || '';
}
