import { styled } from '../core/style';
import type { MergedVariables } from './variable.merge';

function plural(count: number): string {
  return count === 1 ? 'variable' : 'variables';
}

export function variablesSetLine(merged: MergedVariables, outputIsTTY: boolean, state = 'set'): string {
  const total = merged.variables.length;
  const provenance = [
    ...merged.added.map(({ label, count }) => `${count} from ${label}`),
    ...merged.overrides.map(({ label, keys }) => `${keys.join(', ')} overridden by ${label}`),
  ];

  const origin = provenance.length > 0 ? ` — ${provenance.join(', ')}` : '';

  return styled(`✔ ${total} ${plural(total)} ${state}${origin}`, 'green', outputIsTTY);
}
