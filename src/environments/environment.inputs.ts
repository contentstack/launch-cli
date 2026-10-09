import { Flags } from '@contentstack/cli-utilities';

import type { ResolutionSpec } from '../core/resolution';
import { onlyWithValueOf } from '../core/rules';
import { oneOf, withinLength } from '../core/values';
import type { FrameworkPreset } from './frameworks';
import { FRAMEWORK_CHOICES, FRAMEWORK_PRESET_BY_LABEL, SERVER_COMMAND_FRAMEWORKS } from './frameworks';

export const ENVIRONMENT_NAME_MAX_LENGTH = 200;

export const CREATE_PROMPT_REMEDIES = { config: false, prompt: true };

export const RESPONSE_MODES = ['buffered', 'streaming'] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

export const TOGGLE_VALUES = ['enable', 'disable'] as const;

export type ToggleValue = (typeof TOGGLE_VALUES)[number];

export function frameworkPresetOf(value: string): FrameworkPreset {
  return FRAMEWORK_PRESET_BY_LABEL[oneOf('framework', value, FRAMEWORK_CHOICES).toLowerCase()];
}

export const environmentFlags = {
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
};

export const serverCommandFrameworkGate = onlyWithValueOf('server-cmd', 'framework', SERVER_COMMAND_FRAMEWORKS);

export const environmentResolution = {
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
};
