import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import type { ResolutionSpec } from '../core/resolution';
import type { CacheCriterion, CachePath, PurgeTarget } from './types';

const WILDCARD_SUFFIX = '/*';

export const cacheFlags = {
  path: Flags.string({
    description:
      'Path to purge, for example /blog. End it with /* to purge everything beneath it, or pass /* for the whole site',
  }),
  prefix: Flags.boolean({
    description: 'With --path, purge everything beneath the path as well (a prefix match, like ending it with /*)',
  }),
  tags: Flags.string({ description: 'Comma-separated cache tags to purge' }),
  hosts: Flags.string({ description: 'Comma-separated hostnames to purge' }),
};

async function normalizePath(value: string): Promise<CachePath> {
  const typed = value.trim();

  if (!typed.startsWith('/')) {
    throw new UsageError(`--path must start with "/"; "${value}" does not.`);
  }

  const isPrefix = typed.endsWith(WILDCARD_SUFFIX);
  const stripped = isPrefix ? typed.slice(0, -WILDCARD_SUFFIX.length) : typed;

  return { path: stripped === '' ? '/' : stripped, isPrefix, typed };
}

export function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))];
}

function listNormalizer(flag: string) {
  return async (value: string): Promise<string[]> => {
    const entries = splitList(value);

    if (entries.length === 0) {
      throw new UsageError(`--${flag} must name at least one value; "${value}" names none.`);
    }

    return entries;
  };
}

export const cacheResolution = {
  path: { normalize: normalizePath } satisfies ResolutionSpec<string | CachePath, never, CachePath>,
  prefix: {} satisfies ResolutionSpec<boolean>,
  tags: { normalize: listNormalizer('tags') } satisfies ResolutionSpec<string | string[], never, string[]>,
  hosts: { normalize: listNormalizer('hosts') } satisfies ResolutionSpec<string | string[], never, string[]>,
};

export function criterionOf({ path, prefix, tags, hosts }: PurgeTarget): CacheCriterion {
  return {
    ...(path && { cachePath: { path: path.path, isPrefix: path.isPrefix || prefix === true } }),
    ...(tags && { cacheTags: tags }),
    ...(hosts && { hostnames: hosts }),
  };
}
