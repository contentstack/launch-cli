import { styled } from '../core/style';
import type { PurgeTarget } from './types';

const TASK_LINE = '→ CDN cache revalidation task initiated.';

function describeTarget({ path, tags, hosts }: PurgeTarget): string {
  return [
    path && `path ${path.typed} (${path.isPrefix ? 'prefix' : 'exact'} match)`,
    tags && `tags ${tags.join(', ')}`,
    hosts && `hosts ${hosts.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' and ');
}

export function purgeInitiatedLines(target: PurgeTarget, environmentName: string, outputIsTTY: boolean): string[] {
  const initiated = `✔ Cache purge initiated for ${describeTarget(target)} in environment "${environmentName}".`;

  return [styled(initiated, 'green', outputIsTTY), TASK_LINE];
}
