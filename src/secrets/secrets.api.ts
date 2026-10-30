import { isRecord } from '../core/values';
import { assertArray } from '../transport/envelope';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { SECRETS_ERROR_MESSAGES, asSecretsFailure } from './secrets.errors';
import type { Secret, SecretsParams } from './types';

export * from './types';

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function secretOf(entry: unknown): Secret[] {
  return isRecord(entry) ? [{ key: textOf(entry.key), updatedAt: textOf(entry.updatedAt) }] : [];
}

function secretsPath({ project, environment }: SecretsParams): string {
  return `/projects/${project}/environments/${environment}/secrets`;
}

export class SecretsApi {
  constructor(private readonly client: RestApiClient) {}

  private async request<T>(req: RestRequest): Promise<T> {
    try {
      return await this.client.request<T>(req, SECRETS_ERROR_MESSAGES);
    } catch (error) {
      throw asSecretsFailure(error);
    }
  }

  async list(params: SecretsParams): Promise<Secret[]> {
    const response = await this.request<unknown>({
      method: 'GET',
      path: secretsPath(params),
      orgUid: params.org,
      projectUid: params.project,
    });

    assertArray(response, 'secrets', 'secret list');

    return (response as { secrets: unknown[] }).secrets.flatMap(secretOf);
  }
}
