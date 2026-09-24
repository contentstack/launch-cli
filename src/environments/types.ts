import type { Pagination } from '../core/render';

export type { Pagination };

export const FRAMEWORK_PRESETS = [
  'GATSBY',
  'NEXTJS',
  'CRA',
  'CSR',
  'ANALOG',
  'ANGULAR',
  'NUXT',
  'ASTRO',
  'VUEJS',
  'REMIX',
  'OTHER',
] as const;

export type FrameworkPreset = (typeof FRAMEWORK_PRESETS)[number];

export const SERVER_COMMAND_FRAMEWORKS: readonly FrameworkPreset[] = [
  'ANALOG',
  'ANGULAR',
  'NUXT',
  'ASTRO',
  'REMIX',
  'OTHER',
];

export interface EnvironmentVariableInput {
  key: string;
  value: string;
}

export interface EnvironmentDomain {
  url?: string;
}

export interface Environment {
  uid: string;
  name?: string;
  gitBranch?: string;
  frameworkPreset?: string;
  buildCommand?: string;
  outputDirectory?: string;
  serverCommand?: string;
  domains?: EnvironmentDomain[];
}

export interface EnvironmentsPage {
  pagination: Pagination;
  environments: Environment[];
}

export interface CreateEnvironmentInput {
  name: string;
  description?: string;
  gitBranch?: string;
  uploadUid?: string;
  buildCommand?: string;
  outputDirectory: string;
  serverCommand?: string;
  frameworkPreset: FrameworkPreset;
  environmentVariables: EnvironmentVariableInput[];
  isStreamingEnabled?: boolean;
  autoDeployOnPush?: boolean;
  isContentstackAuthenticationEnabled?: boolean;
}
