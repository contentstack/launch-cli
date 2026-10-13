import { HttpClient } from '@contentstack/cli-utilities';

import type { HttpClientLike } from './rest-client';

export function disarmResponseInterceptors(client: HttpClient): HttpClient {
  client.interceptors.response.use = () => 0;
  return client;
}

export function withoutDefaultContentType(client: HttpClient): HttpClient {
  const { headers } = client.requestConfig();

  if (headers) {
    headers['Content-Type'] = false;
  }

  return client;
}

export function createUtilityHttpClient(): HttpClientLike {
  return withoutDefaultContentType(disarmResponseInterceptors(HttpClient.create()));
}
