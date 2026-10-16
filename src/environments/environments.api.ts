import { MAX_PAGES } from '../core/constants';
import { scanPages } from '../core/paging';
import { UsageError } from '../core/errors';
import { assertPage, hasUid, malformed, unwrap } from '../transport/envelope';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { DUPLICATE_NAME_CODE, ENVIRONMENT_ERROR_MESSAGES } from './environment.errors';
import type {
  CreateEnvironmentInput,
  Environment,
  EnvironmentUpdate,
  EnvironmentsPage,
  IdentifiedEnvironment,
} from './types';

export * from './types';

export interface ListEnvironmentsParams {
  org: string;
  project: string;
  limit?: number;
  skip?: number;
}

export const ENVIRONMENT_SCAN_PAGE_SIZE = 100;

export interface PageEnvironmentsParams {
  org: string;
  project: string;
}

export class EnvironmentScanLimitError extends UsageError {
  constructor() {
    super(
      `Stopped after scanning ${MAX_PAGES} pages of environments without reaching the end of the project. ` +
        'Pass --env with the environment uid instead of its name.',
    );
    this.name = 'EnvironmentScanLimitError';
  }
}

export interface EnvironmentParams {
  org: string;
  project: string;
  environment: string;
}

export interface CreateEnvironmentParams {
  org: string;
  project: string;
  input: CreateEnvironmentInput;
}

export interface UpdateEnvironmentParams extends EnvironmentParams {
  update: EnvironmentUpdate;
}

function asTakenName(error: unknown, renaming: boolean): unknown {
  if (!renaming || !(error instanceof LaunchApiError) || error.status !== 409) {
    return error;
  }

  const namesAnotherConflict = error.errors.some(
    (entry) =>
      (entry.code !== undefined || entry.message !== undefined) &&
      entry.code !== DUPLICATE_NAME_CODE &&
      entry.message !== DUPLICATE_NAME_CODE,
  );

  if (namesAnotherConflict) {
    return error;
  }

  return new LaunchApiError(409, [{ code: DUPLICATE_NAME_CODE }], ENVIRONMENT_ERROR_MESSAGES);
}

export class EnvironmentsApi {
  constructor(private readonly client: RestApiClient) {}

  private request<T>(req: RestRequest): Promise<T> {
    return this.client.request<T>(req, ENVIRONMENT_ERROR_MESSAGES);
  }

  async list(params: ListEnvironmentsParams): Promise<EnvironmentsPage> {
    const response = await this.request<EnvironmentsPage>({
      method: 'GET',
      path: `/projects/${params.project}/environments`,
      orgUid: params.org,
      projectUid: params.project,
      query: { limit: params.limit, skip: params.skip },
    });

    assertPage(response, 'environments', 'environment list');

    return response;
  }

  pages(params: PageEnvironmentsParams): AsyncGenerator<EnvironmentsPage> {
    return scanPages(
      (window) => this.list({ ...params, ...window }),
      (page) => page.environments,
      ENVIRONMENT_SCAN_PAGE_SIZE,
      () => new EnvironmentScanLimitError(),
    );
  }

  async get(params: EnvironmentParams): Promise<Environment> {
    const response = await this.request<unknown>({
      method: 'GET',
      path: `/projects/${params.project}/environments/${params.environment}`,
      orgUid: params.org,
      projectUid: params.project,
    });

    return unwrap<Environment>(response, 'environment', 'environment response');
  }

  async create(params: CreateEnvironmentParams): Promise<IdentifiedEnvironment> {
    const response = await this.request<unknown>({
      method: 'POST',
      path: `/projects/${params.project}/environments`,
      orgUid: params.org,
      projectUid: params.project,
      body: params.input,
    });
    const environment = unwrap<Environment>(response, 'environment', 'environment response');

    if (!hasUid(environment)) {
      throw malformed('The Launch API returned an environment response without an environment uid.');
    }

    return environment;
  }

  async update(params: UpdateEnvironmentParams): Promise<Environment> {
    const response = await this.request<unknown>({
      method: 'PUT',
      path: `/projects/${params.project}/environments/${params.environment}`,
      orgUid: params.org,
      projectUid: params.project,
      body: params.update,
    }).catch((error: unknown) => {
      throw asTakenName(error, params.update.name !== undefined);
    });

    return unwrap<Environment>(response, 'environment', 'environment response');
  }

  async delete(params: EnvironmentParams): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/projects/${params.project}/environments/${params.environment}`,
      orgUid: params.org,
      projectUid: params.project,
    });
  }

  async first(params: { org: string; project: string }): Promise<IdentifiedEnvironment | undefined> {
    const page = await this.list({ ...params, limit: 1, skip: 0 });
    const [environment] = page.environments;

    if (environment === undefined) {
      return undefined;
    }

    if (!hasUid(environment)) {
      throw malformed('The Launch API returned an environment without an environment uid.');
    }

    return environment;
  }
}
