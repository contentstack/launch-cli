import { UsageError } from '../core/errors';
import type { Rule } from '../core/rules';
import { isAbsent } from '../core/values';

export const aliasRequiresFromStack: Rule = (resolved) => {
  if (!isAbsent(resolved.alias) && resolved['from-stack'] !== true) {
    throw new UsageError('--alias is only used with --from-stack.');
  }
};

function hasValues(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value === true;
}

export const noVarsAlone: Rule = (resolved) => {
  if (resolved['no-vars'] === true && [resolved.var, resolved.dotenv, resolved['from-stack']].some(hasValues)) {
    throw new UsageError('--no-vars cannot be combined with --var, --dotenv or --from-stack.');
  }
};
