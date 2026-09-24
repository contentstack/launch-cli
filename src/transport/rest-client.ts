import { API_VERSION } from '../core/constants';
import { AuthStrategy } from './auth-strategy';
import { ErrorMessages, diagnoseTransportError, parseErrorEnvelope } from './errors';
import { HttpMethod, RetryPolicy } from './retry-policy';
import { createUtilityHttpClient } from './utility-http-client';

export { HTTP_METHODS } from './retry-policy';
export type { HttpMethod } from './retry-policy';

export interface RestRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  orgUid?: string;
  projectUid?: string;
}

export interface HttpClientLike {
  baseUrl(url: string): HttpClientLike;
  asJson(): HttpClientLike;
  headers(headers: Record<string, string>): HttpClientLike;
  queryParams(query: object): HttpClientLike;
  payload(body: unknown): HttpClientLike;
  send(method: HttpMethod, path: string): Promise<{ status: number; data: unknown }>;
}

export interface RestApiClientOptions {
  baseUrl: string;
  analyticsInfo: string;
  auth: AuthStrategy;
  createHttpClient?: () => HttpClientLike;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function pruneUndefined(query: Record<string, string | number | undefined>): Record<string, string | number> {
  const pruned: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      pruned[key] = value;
    }
  }
  return pruned;
}

function scopeHeader(headers: Record<string, string>, name: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }

  if (value.trim() === '') {
    throw new Error(`${name} was given a blank value; an unscoped Launch API request is never correct.`);
  }

  headers[name] = value;
}

const EXPIRED_TOKEN_MESSAGE = 'access token is invalid or expired';

function isAuthChallenge(status: number, data: unknown): boolean {
  if (status === 401) {
    return true;
  }

  const { error_message: errorMessage } = (data ?? {}) as { error_message?: unknown };

  return typeof errorMessage === 'string' && errorMessage.includes(EXPIRED_TOKEN_MESSAGE);
}

export class RestApiClient {
  constructor(private readonly options: RestApiClientOptions) {}

  async request<T>(req: RestRequest, errorMessages: ErrorMessages = {}): Promise<T> {
    const policy = new RetryPolicy(this.options);
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      let response: { status: number; data: unknown };

      try {
        response = await this.send(req);
      } catch (error) {
        if (policy.shouldRetryTransportError(error, req.method, attempt)) {
          attempt += 1;
          await sleep(policy.delayFor(attempt));
          continue;
        }

        throw error;
      }

      if (response.status >= 200 && response.status < 300) {
        return response.data as T;
      }

      if (!refreshed && this.options.auth.refresh && isAuthChallenge(response.status, response.data)) {
        refreshed = true;
        await this.options.auth.refresh();
        continue;
      }

      if (policy.shouldRetry(response.status, req.method, attempt)) {
        attempt += 1;
        await sleep(policy.delayFor(attempt));
        continue;
      }

      throw parseErrorEnvelope(response.status, response.data, errorMessages);
    }
  }

  private async send(req: RestRequest): Promise<{ status: number; data: unknown }> {
    const create = this.options.createHttpClient ?? createUtilityHttpClient;
    const client = create();

    const headers: Record<string, string> = {
      'X-CS-CLI': this.options.analyticsInfo,
      'x-cs-api-version': API_VERSION,
      ...(await this.options.auth.headers(req.orgUid)),
    };

    scopeHeader(headers, 'x-organization-uid', req.orgUid);
    scopeHeader(headers, 'x-project-uid', req.projectUid);

    client.baseUrl(this.options.baseUrl).headers(headers);

    if (req.query) {
      client.queryParams(pruneUndefined(req.query));
    }

    if (req.body !== undefined) {
      client.asJson().payload(req.body);
    }

    try {
      return await client.send(req.method, req.path);
    } catch (error) {
      throw diagnoseTransportError(error);
    }
  }
}
