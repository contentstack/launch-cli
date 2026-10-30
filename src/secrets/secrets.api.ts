import { isRecord } from '../core/values';
import { assertArray } from '../transport/envelope';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import type { ErrorMessages } from '../transport/errors';
import { SECRETS_ERROR_MESSAGES, asSecretsFailure, secretKeyMessages } from './secrets.errors';
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

  private async request<T>(req: RestRequest, messages: ErrorMessages = SECRETS_ERROR_MESSAGES): Promise<T> {
    try {
      return await this.client.request<T>(req, messages);
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

  async add(params: SecretsParams, key: string, value: string): Promise<Secret> {
    const response = await this.request<unknown>(
      {
        method: 'POST',
        path: secretsPath(params),
        orgUid: params.org,
        projectUid: params.project,
        body: { key, value },
      },
      secretKeyMessages(key),
    );

    return secretOf(response)[0] ?? {};
  }

  async refresh(params: SecretsParams, key: string, value: string): Promise<Secret> {
    const response = await this.request<unknown>(
      {
        method: 'PUT',
        path: `${secretsPath(params)}/${encodeURIComponent(key)}`,
        orgUid: params.org,
        projectUid: params.project,
        body: { value },
      },
      secretKeyMessages(key),
    );

    return secretOf(response)[0] ?? {};
  }
}
