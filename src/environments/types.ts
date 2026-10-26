import type { Pagination } from '../core/render';
import type { ResponseMode, ToggleValue } from './environment.inputs';
import type { FrameworkPreset } from './frameworks';

export type { Pagination };

export interface EnvironmentVariableInput {
  key: string;
  value: string;
}

export interface EnvironmentDomain {
  url?: string;
}

export interface EnvironmentPasswordProtection {
  isEnabled?: boolean;
}

export interface EnvironmentVariable {
  key?: string;
  value?: string;
}

export interface Environment {
  uid?: string;
  name?: string;
  description?: string;
  gitBranch?: string;
  frameworkPreset?: string;
  buildCommand?: string;
  outputDirectory?: string;
  serverCommand?: string;
  domains?: EnvironmentDomain[];
  autoDeployOnPush?: boolean;
  isContentstackAuthenticationEnabled?: boolean;
  isCachePrimingEnabled?: boolean;
  passwordProtection?: EnvironmentPasswordProtection;
  environmentVariables?: EnvironmentVariable[];
  organizationUid?: string;
  project?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PasswordProtectionUpdate {
  isEnabled: boolean;
  username?: string;
  password?: string;
}

export interface EnvironmentUpdate {
  name?: string;
  description?: string;
  gitBranch?: string;
  frameworkPreset?: string;
  buildCommand?: string;
  serverCommand?: string;
  outputDirectory?: string;
  isStreamingEnabled?: boolean;
  autoDeployOnPush?: boolean;
  isContentstackAuthenticationEnabled?: boolean;
  isCachePrimingEnabled?: boolean;
  passwordProtection?: PasswordProtectionUpdate;
  environmentVariables?: EnvironmentVariableInput[];
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

export interface DetectedFramework {
  framework?: string;
  outputDirectory?: string;
  serverCommand?: string;
  buildCommand?: string;
}

export interface EnvironmentRequest {
  org: string;
  dataDir?: string;
  vars?: string[];
  envFiles?: string[];
  fromStack?: boolean;
  alias?: string;
  noVars?: boolean;
  framework?: FrameworkPreset;
  buildCmd?: string;
  outputDir?: string;
  serverCmd?: string;
  resMode?: ResponseMode;
  csAuth?: ToggleValue;
}

export interface EnvironmentSource {
  detected: DetectedFramework;
  branch?: string;
  uploadUid?: string;
}
