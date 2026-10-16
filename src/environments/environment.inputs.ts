import { Flags } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import type { ResolutionSpec } from '../core/resolution';
import { onlyWithValueOf } from '../core/rules';
import { oneOf, withinLength } from '../core/values';
import { ResourceRef } from '../core/resource-ref';
import { promptForEnvironment } from './environment.prompt';
import { EnvironmentResolver } from './environment.resolver';
import type { FrameworkPreset } from './frameworks';
import { FRAMEWORK_CHOICES, FRAMEWORK_PRESET_BY_LABEL, SERVER_COMMAND_FRAMEWORKS } from './frameworks';

export const ENVIRONMENT_NAME_MAX_LENGTH = 200;

export const ENVIRONMENT_DESCRIPTION_MAX_LENGTH = 255;

const ENVIRONMENT_WORDING: Record<string, string> = {
  name: `Environment name (${ENVIRONMENT_NAME_MAX_LENGTH} characters or fewer)`,
  description: `Environment description (${ENVIRONMENT_DESCRIPTION_MAX_LENGTH} characters or fewer)`,
};

export function withEnvironmentWording<F extends Record<string, object>>(flags: F): F {
  return Object.fromEntries(
    Object.entries(flags).map(([key, flag]) => [
      key,
      key in ENVIRONMENT_WORDING ? { ...flag, description: ENVIRONMENT_WORDING[key] } : flag,
    ]),
  ) as F;
}

export const RESPONSE_MODES = ['buffered', 'streaming'] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

export const TOGGLE_VALUES = ['enable', 'disable'] as const;

export type ToggleValue = (typeof TOGGLE_VALUES)[number];

export function frameworkPresetOf(value: string): FrameworkPreset {
  return FRAMEWORK_PRESET_BY_LABEL[oneOf('framework', value, FRAMEWORK_CHOICES).toLowerCase()];
}

export const ENVIRONMENT_DEPENDENCIES = { env: ['org', 'project'] } as const;

export const environmentFlags = {
  env: Flags.string({ description: 'Environment name or UID' }),
  'env-name': Flags.string({
    description:
      'Name of the environment created with the project ' +
      `(${ENVIRONMENT_NAME_MAX_LENGTH} characters or fewer)`,
  }),
  branch: Flags.string({ description: 'Git branch name, GitHub projects only' }),
  framework: Flags.string({ description: `Framework preset (${FRAMEWORK_CHOICES.join(' | ')})` }),
  'build-cmd': Flags.string({ description: 'Build command' }),
  'server-cmd': Flags.string({ description: 'Server command' }),
  'output-dir': Flags.string({ description: 'Output directory' }),
  'res-mode': Flags.string({ description: `Response mode (${RESPONSE_MODES.join(' | ')})` }),
  'auto-deploy': Flags.string({
    description: `Deploy on every push, GitHub projects only (${TOGGLE_VALUES.join(' | ')})`,
  }),
  'cs-auth': Flags.string({ description: `Contentstack Authentication (${TOGGLE_VALUES.join(' | ')})` }),
  'cache-priming': Flags.string({ description: `Cache priming (${TOGGLE_VALUES.join(' | ')})` }),
  'password-protection': Flags.string({ description: `Password protection (${TOGGLE_VALUES.join(' | ')})` }),
  username: Flags.string({ char: 'u', description: 'Password protection username, with --password-protection enable' }),
  password: Flags.boolean({
    char: 'p',
    description:
      'With --password-protection enable: read the password from standard input when there is no terminal ' +
      '(on a terminal it is asked at a hidden prompt)',
  }),
};

export async function usernameOf(value: string): Promise<string> {
  const username = value.trim();

  if (username.includes(':')) {
    throw new UsageError('--username must not contain ":".');
  }

  return username;
}

export const serverCommandFrameworkGate = onlyWithValueOf('server-cmd', 'framework', SERVER_COMMAND_FRAMEWORKS);

export const environmentResolution = {
  env: {
    dependsOn: ENVIRONMENT_DEPENDENCIES.env,
    prompt: ({ services, resolved }) =>
      promptForEnvironment(services, { org: resolved.org, project: resolved.project }),
    normalize: (value, { services, resolved, source }) =>
      new EnvironmentResolver(services.api.environments).toUid(
        { org: resolved.org, project: resolved.project },
        source === 'flag' ? ResourceRef.parse(value) : ResourceRef.uid(value),
      ),
  } satisfies ResolutionSpec<string, 'org' | 'project'>,
  'env-name': {
    normalize: (value) => withinLength('env-name', value, ENVIRONMENT_NAME_MAX_LENGTH),
  } satisfies ResolutionSpec<string>,
  branch: {} satisfies ResolutionSpec<string>,
  framework: {
    normalize: async (value) => frameworkPresetOf(value),
  } satisfies ResolutionSpec<string, never, FrameworkPreset>,
  'build-cmd': {} satisfies ResolutionSpec<string>,
  'server-cmd': {} satisfies ResolutionSpec<string>,
  'output-dir': {} satisfies ResolutionSpec<string>,
  'res-mode': {
    normalize: async (value) => oneOf('res-mode', value, RESPONSE_MODES),
  } satisfies ResolutionSpec<string, never, ResponseMode>,
  'auto-deploy': {
    normalize: async (value) => oneOf('auto-deploy', value, TOGGLE_VALUES),
  } satisfies ResolutionSpec<string, never, ToggleValue>,
  'cs-auth': {
    normalize: async (value) => oneOf('cs-auth', value, TOGGLE_VALUES),
  } satisfies ResolutionSpec<string, never, ToggleValue>,
  'cache-priming': {
    normalize: async (value) => oneOf('cache-priming', value, TOGGLE_VALUES),
  } satisfies ResolutionSpec<string, never, ToggleValue>,
  'password-protection': {
    normalize: async (value) => oneOf('password-protection', value, TOGGLE_VALUES),
  } satisfies ResolutionSpec<string, never, ToggleValue>,
  username: { normalize: usernameOf } satisfies ResolutionSpec<string>,
  password: { default: false } satisfies ResolutionSpec<boolean>,
};
