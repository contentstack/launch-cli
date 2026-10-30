import { isRecord } from '../core/values';
import type { EnvironmentParams } from '../environments/environments.api';
import { assertArray } from '../transport/envelope';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { SECRETS_ERROR_MESSAGES, asReadFailure } from './secrets.errors';
import type { SecretSummary } from './types';

export * from './types';

export function secretsPath({ project, environment }: EnvironmentParams, key?: string): string {
  const base = `/projects/${project}/environments/${environment}/secrets`;

  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function summaryOf(entry: unknown): SecretSummary[] {
  return isRecord(entry) ? [{ key: textOf(entry.key), updatedAt: textOf(entry.updatedAt) }] : [];
}

export class SecretsApi {
  constructor(private readonly client: RestApiClient) {}

  private request<T>(req: RestRequest): Promise<T> {
    return this.client.request<T>(req, SECRETS_ERROR_MESSAGES);
  }

  async list(params: EnvironmentParams): Promise<SecretSummary[]> {
    const response = await this.request<unknown>({
      method: 'GET',
      path: secretsPath(params),
      orgUid: params.org,
      projectUid: params.project,
    }).catch((error: unknown) => {
      throw asReadFailure(error);
    });

    assertArray(response, 'secrets', 'secret list');

    return (response as { secrets: unknown[] }).secrets.flatMap(summaryOf);
  }
}
