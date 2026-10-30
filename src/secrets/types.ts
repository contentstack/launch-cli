import type { EnvironmentParams } from '../environments/environments.api';

export interface SecretSummary {
  key: string | undefined;
  updatedAt: string | undefined;
}

export interface SecretWriteResult {
  key: string | undefined;
  updatedAt: string | undefined;
}

export interface SecretKeyParams extends EnvironmentParams {
  key: string;
}

export interface SecretWriteParams extends SecretKeyParams {
  value: string;
}
