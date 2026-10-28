import { Flags } from '@contentstack/cli-utilities';

import { InputDependencyError } from '../core/errors';
import type { ResolutionSpec } from '../core/resolution';
import type { Rule } from '../core/rules';
import { requireValueOf } from '../core/rules';
import { isAbsent, oneOf } from '../core/values';

export const LOG_TYPES = ['deployment', 'server', 'live'] as const;

export type LogType = (typeof LOG_TYPES)[number];

export const DEFAULT_LOG_TYPE: LogType = 'deployment';

export const LOG_TYPE_FLAG = 'type';

export const WINDOW_LOG_TYPES: readonly LogType[] = ['server'];

const WINDOW_FORMATS = 'relative (45s, 30m, 12hr, 2d) or an ISO 8601 timestamp with an offset';

export const logsFlags = {
  'log-type': Flags.string({
    description: `Kind of logs to read (${LOG_TYPES.join(' | ')}). Defaults to ${DEFAULT_LOG_TYPE}`,
  }),
  since: Flags.string({
    description: `Server logs only: start of the window, ${WINDOW_FORMATS}. Defaults to one hour before --until`,
  }),
  until: Flags.string({
    description: `Server logs only: end of the window, ${WINDOW_FORMATS}. Defaults to now`,
  }),
};

export function logTypeOf(value: string): LogType {
  return oneOf(LOG_TYPE_FLAG, value, LOG_TYPES);
}

export const logsResolution = {
  'log-type': {
    default: DEFAULT_LOG_TYPE,
    normalize: async (value) => logTypeOf(value),
  } satisfies ResolutionSpec<string, never, LogType>,
  since: { normalize: async (value) => value.trim() } satisfies ResolutionSpec<string>,
  until: { normalize: async (value) => value.trim() } satisfies ResolutionSpec<string>,
};

export function windowOnlyWithServer(flag: 'since' | 'until'): Rule {
  return (resolved) => {
    if (isAbsent(resolved[flag])) {
      return;
    }

    const type = resolved['log-type'];

    if (typeof type !== 'string') {
      throw new InputDependencyError(
        `--${flag} cannot be checked without --${LOG_TYPE_FLAG}: declare log-type in the command inputs.`,
      );
    }

    requireValueOf(flag, LOG_TYPE_FLAG, WINDOW_LOG_TYPES, type);
  };
}
