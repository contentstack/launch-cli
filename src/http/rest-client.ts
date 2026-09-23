import { HttpClient } from '@contentstack/cli-utilities';

import { API_VERSION } from '../config/constants';
import { parseErrorEnvelope } from './errors';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

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
  authHeaders: (orgUid?: string) => Promise<Record<string, string>>;
  refreshAuth?: () => Promise<unknown>;
  createHttpClient?: () => HttpClientLike;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'HEAD']);

function isRetryable(status: number, method: HttpMethod): boolean {
  if (status === 429) {
    return true;
  }

  return status === 408 && IDEMPOTENT_METHODS.has(method);
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

export class RestApiClient {
  constructor(private readonly options: RestApiClientOptions) {}

  async request<T>(req: RestRequest): Promise<T> {
    const maxRetries = this.options.maxRetries ?? 3;
    const retryDelayMs = this.options.retryDelayMs ?? 1000;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      const response = await this.send(req);

      if (response.status >= 200 && response.status < 300) {
        return response.data as T;
      }

      if (response.status === 401 && !refreshed && this.options.refreshAuth) {
        refreshed = true;
        await this.options.refreshAuth();
        continue;
      }

      if (isRetryable(response.status, req.method) && attempt < maxRetries) {
        attempt += 1;
        await sleep(retryDelayMs * attempt);
        continue;
      }

      throw parseErrorEnvelope(response.status, response.data);
    }
  }

  private async send(req: RestRequest): Promise<{ status: number; data: unknown }> {
    const create = this.options.createHttpClient ?? (() => HttpClient.create() as unknown as HttpClientLike);
    const client = create();

    const headers: Record<string, string> = {
      'X-CS-CLI': this.options.analyticsInfo,
      'x-cs-api-version': API_VERSION,
      ...(await this.options.authHeaders(req.orgUid)),
    };

    if (req.orgUid) {
      headers['x-organization-uid'] = req.orgUid;
    }

    if (req.projectUid) {
      headers['x-project-uid'] = req.projectUid;
    }

    client.baseUrl(this.options.baseUrl).asJson().headers(headers);

    if (req.query) {
      client.queryParams(pruneUndefined(req.query));
    }

    if (req.body !== undefined) {
      client.payload(req.body);
    }

    return client.send(req.method, req.path);
  }
}
