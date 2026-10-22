import { UsageError } from '../core/errors';
import type { Rule } from '../core/rules';
import { isAbsent } from '../core/values';

export const aliasRequiresFromStack: Rule = (resolved) => {
  if (!isAbsent(resolved.alias) && resolved['from-stack'] !== true) {
    throw new UsageError('--alias is only used with --from-stack.');
  }
};
