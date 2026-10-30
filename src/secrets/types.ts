import type { EnvironmentParams } from '../environments/environments.api';

export interface SecretSummary {
  key: string | undefined;
  updatedAt: string | undefined;
}

export interface SecretWriteResult {
  key: string | undefined;
  updatedAt: string | undefined;
}

export interface SecretWriteParams extends EnvironmentParams {
  key: string;
  value: string;
}
