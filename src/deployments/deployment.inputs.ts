import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import type { ResolutionSpec } from '../core/resolution';
import { UID_PATTERN } from '../core/resource-ref';
import { promptForDeployment } from './deployment.prompt';

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

export const DEPLOYMENT_DEPENDENCIES = { deployment: ['org', 'project', 'env'] } as const;

export const deploymentFlags = {
  deployment: Flags.string({ description: 'Deployment UID' }),
  commit: Flags.string({
    description:
      'GitHub projects: deploy this commit. Pass --commit with no value to pick one from the recent commits',
    exclusive: ['last-upload'],
  }),
  reason: Flags.string({ description: 'Why the environment is being rolled back, recorded with the rollback' }),
  'last-upload': Flags.boolean({
    description: 'FileUpload projects: redeploy the last uploaded bundle without uploading a new one',
  }),
};

export const deploymentResolution = {
  deployment: {
    dependsOn: DEPLOYMENT_DEPENDENCIES.deployment,
    promptWhen: (input) => input.picker !== undefined,
    prompt: ({ input, services, resolved }) =>
      promptForDeployment(
        services,
        { org: resolved.org, project: resolved.project, environment: resolved.env },
        input.picker,
      ),
    normalize: async (value) => {
      const uid = value.trim();

      if (!UID_PATTERN.test(uid)) {
        throw new UsageError(`--deployment must be a deployment UID (24 hexadecimal characters); "${uid}" is not.`);
      }

      return uid;
    },
  } satisfies ResolutionSpec<string, 'org' | 'project' | 'env'>,
  commit: {
    normalize: async (value) => {
      if (value === BLANK_COMMIT) {
        throw new UsageError('--commit needs a commit hash. Pass --commit <sha>.');
      }

      return value.trim();
    },
  } satisfies ResolutionSpec<string>,
  reason: {
    normalize: async (value) => value.trim(),
  } satisfies ResolutionSpec<string>,
  'last-upload': { default: false } satisfies ResolutionSpec<boolean>,
};
