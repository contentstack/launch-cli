export interface Secret {
  key?: string;
  updatedAt?: string;
}

export interface SecretsParams {
  org: string;
  project: string;
  environment: string;
}
