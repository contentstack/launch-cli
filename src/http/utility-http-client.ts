import { HttpClient } from '@contentstack/cli-utilities';

import type { HttpClientLike } from './rest-client';

export function disarmResponseInterceptors(client: HttpClient): HttpClient {
  client.interceptors.response.use = () => 0;
  return client;
}

export function createUtilityHttpClient(): HttpClientLike {
  return disarmResponseInterceptors(HttpClient.create()) as unknown as HttpClientLike;
}
