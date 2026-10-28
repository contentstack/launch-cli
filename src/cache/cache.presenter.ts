import { styled } from '../core/style';
import type { PurgeTarget } from './types';

function describeTarget({ path, tags, hosts }: PurgeTarget): string {
  if (path) {
    return path.path;
  }

  if (tags) {
    return `tags: ${tags.join(', ')}`;
  }

  const count = hosts?.length ?? 0;

  return `${count} ${count === 1 ? 'domain' : 'domains'}`;
}

export function purgeInitiatedLines(target: PurgeTarget, outputIsTTY: boolean): string[] {
  return [styled(`✔ Cache purge initiated for ${describeTarget(target)}.`, 'green', outputIsTTY)];
}
