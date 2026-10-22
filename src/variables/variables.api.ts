import { isRecord } from '../core/values';
import { ENVIRONMENT_ERROR_MESSAGES } from '../environments/environment.errors';
import type { EnvironmentParams } from '../environments/environments.api';
import type { EnvironmentVariableInput } from '../environments/types';
import { malformed } from '../transport/envelope';
import type { ErrorMessages } from '../transport/errors';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient } from '../transport/rest-client';
import { someNotSetError } from './variable.errors';

export interface StackTemplateEntry {
  key: string;
  value: string | undefined;
}

const VARIABLE_ERROR_MESSAGES: ErrorMessages = {};

const KEY_NOT_FOUND_CODE = 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_FOUND';

export interface PatchVariablesParams extends EnvironmentParams {
  set?: EnvironmentVariableInput[];
  unset?: string[];
}

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

  async patch({ org, project, environment, set, unset }: PatchVariablesParams): Promise<void> {
    await this.client
      .request<unknown>(
        {
          method: 'PATCH',
          path: `/projects/${project}/environments/${environment}/variables`,
          orgUid: org,
          projectUid: project,
          body: { ...(set === undefined ? {} : { set }), ...(unset === undefined ? {} : { unset }) },
        },
        ENVIRONMENT_ERROR_MESSAGES,
      )
      .catch((error: unknown) => {
        throw error instanceof LaunchApiError && error.code === KEY_NOT_FOUND_CODE && unset?.length
          ? someNotSetError(unset)
          : error;
      });
  }
}
