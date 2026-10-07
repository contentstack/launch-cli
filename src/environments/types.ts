import type { Pagination } from '../core/render';
import type { FrameworkPreset } from './frameworks';

export type { Pagination };

export interface EnvironmentVariableInput {
  key: string;
  value: string;
}

export interface EnvironmentDomain {
  url?: string;
}

export interface Environment {
  uid?: string;
  name?: string;
  gitBranch?: string;
  frameworkPreset?: string;
  buildCommand?: string;
  outputDirectory?: string;
  serverCommand?: string;
  domains?: EnvironmentDomain[];
}

export type IdentifiedEnvironment = Environment & { uid: string };

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
