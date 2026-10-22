import { isRecord } from '../core/values';
import { malformed } from '../transport/envelope';
import type { ErrorMessages } from '../transport/errors';
import type { RestApiClient } from '../transport/rest-client';

export interface StackTemplateEntry {
  key: string;
  value: string | undefined;
}

const VARIABLE_ERROR_MESSAGES: ErrorMessages = {};

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function entryOf(value: unknown): StackTemplateEntry[] {
  if (!isRecord(value)) {
    return [];
  }

  const key = textOf(value.key);

  return key === undefined ? [] : [{ key, value: textOf(value.value) }];
}

export class VariablesApi {
  constructor(private readonly client: RestApiClient) {}

  async stackTemplate(org: string): Promise<StackTemplateEntry[]> {
    const response = await this.client.request<unknown>(
      { method: 'GET', path: '/cms/environment-variables', orgUid: org },
      VARIABLE_ERROR_MESSAGES,
    );

    if (!Array.isArray(response)) {
      throw malformed('The Launch API returned a stack variable list that is not an array.');
    }

    return response.flatMap(entryOf);
  }
}
