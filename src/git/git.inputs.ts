import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';

export const gitFlags = {
  namespace: Flags.string({ description: 'Git namespace — the user or organization the repository belongs to' }),
  repo: Flags.string({ description: 'Repository, as <namespace>/<repository> or the bare repository name' }),
};

export const gitResolution = {
  namespace: {} satisfies ResolutionSpec<string>,
  repo: {} satisfies ResolutionSpec<string>,
};
