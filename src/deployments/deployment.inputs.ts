import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import type { ResolutionSpec } from '../core/resolution';

export const PICK_COMMIT = '\0pick-commit';

export const BLANK_COMMIT = '\0blank-commit';

const COMMIT_FLAG = '--commit';

const FLAG_TERMINATOR = '--';

function isBlank(value: string): boolean {
  return value.trim() === '';
}

function looksLikeFlag(value: string): boolean {
  return value.startsWith('-') && value !== '-';
}

function commitToken(value: string): string {
  return `${COMMIT_FLAG}=${value}`;
}

export function withBareCommit(argv: readonly string[]): string[] {
  const rewritten: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === FLAG_TERMINATOR) {
      rewritten.push(...argv.slice(index));
      break;
    }

    if (token.startsWith(`${COMMIT_FLAG}=`)) {
      const value = token.slice(COMMIT_FLAG.length + 1);

      rewritten.push(isBlank(value) ? commitToken(BLANK_COMMIT) : token);
      continue;
    }

    if (token !== COMMIT_FLAG) {
      rewritten.push(token);
      continue;
    }

    const next = argv[index + 1];

    if (next === undefined || looksLikeFlag(next)) {
      rewritten.push(commitToken(PICK_COMMIT));
    } else if (isBlank(next)) {
      rewritten.push(commitToken(BLANK_COMMIT));
      index += 1;
    } else {
      rewritten.push(token);
    }
  }

  return rewritten;
}

export const deploymentFlags = {
  deployment: Flags.string({ description: 'Deployment UID' }),
  commit: Flags.string({
    description:
      'GitHub projects: deploy this commit. Pass --commit with no value to pick one from the recent commits',
    exclusive: ['last-upload'],
  }),
  'last-upload': Flags.boolean({
    description: 'FileUpload projects: redeploy the last uploaded bundle without uploading a new one',
  }),
};

export const deploymentResolution = {
  deployment: {
    normalize: async (value) => value.trim(),
  } satisfies ResolutionSpec<string>,
  commit: {
    normalize: async (value) => {
      if (value === BLANK_COMMIT) {
        throw new UsageError('--commit needs a commit hash. Pass --commit <sha>.');
      }

      return value.trim();
    },
  } satisfies ResolutionSpec<string>,
  'last-upload': { default: false } satisfies ResolutionSpec<boolean>,
};
