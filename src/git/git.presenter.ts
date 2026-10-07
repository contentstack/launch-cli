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

export function gitConnectionIdentifiedLine(provider: string, colour: boolean): string {
  return styled(`info: ${provider} connection identified!`, 'green', colour);
}

export function repositoryLabel(repository: GitRepository): string {
  return repository.fullName || repository.name || '';
}
