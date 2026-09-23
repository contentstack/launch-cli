import { ApiSurface } from '../api';
import { DEFAULT_LIMIT } from '../config/constants';
import { UxLike } from '../output/render';
import { promptForProject, resolveProjectUid } from '../select/project';
import { FlagKey } from './catalog';

export interface ResolveServices {
  api: ApiSurface;
  ux: UxLike;
  isTTY: boolean;
}

export interface PromptArgs {
  services: ResolveServices;
  resolved: Record<string, unknown>;
}

export interface ResolutionSpec {
  configPath?: string;
  prompt?: (args: PromptArgs) => Promise<unknown>;
  normalize?: (value: unknown, args: PromptArgs) => Promise<unknown>;
  default?: unknown;
}

export const resolution: Record<FlagKey, ResolutionSpec> = {
  org: { configPath: 'organizationUid' },
  project: {
    configPath: 'uid',
    prompt: ({ services, resolved }) => promptForProject(services, resolved.org as string),
    normalize: (value, { services, resolved }) => resolveProjectUid(services, resolved.org as string, value as string),
  },
  limit: { default: DEFAULT_LIMIT },
  skip: { default: 0 },
  yes: { default: false },
  config: {},
  'data-dir': {},
};
