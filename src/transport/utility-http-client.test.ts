import axios from 'axios';

import { HttpClient } from '@contentstack/cli-utilities';

import { createUtilityHttpClient, disarmResponseInterceptors } from './utility-http-client';

describe('disarmResponseInterceptors', () => {
  it('turns response interceptor registration into a no-op and leaves the handler list empty', () => {
    const client = HttpClient.create();
    const handler = jest.fn();

    disarmResponseInterceptors(client);
    const registered = client.interceptors.response.use(null, handler);

    expect(registered).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect((client.interceptors.response as unknown as { handlers: unknown[] }).handlers).toEqual([]);
  });

  it('leaves the shared axios default interceptors registering handlers as usual', () => {
    const before = axios.interceptors.response.use;

    disarmResponseInterceptors(HttpClient.create());
    const registered = axios.interceptors.response.use(null, jest.fn());

    expect(axios.interceptors.response.use).toBe(before);
    expect(typeof registered).toBe('number');
    expect((axios.interceptors.response as unknown as { handlers: unknown[] }).handlers).toHaveLength(1);
    axios.interceptors.response.eject(registered);
  });

  it('leaves a second utility client built afterwards able to register its own handlers', () => {
    disarmResponseInterceptors(HttpClient.create());
    const untouched = HttpClient.create();

    const registered = untouched.interceptors.response.use(null, jest.fn());

    expect(typeof registered).toBe('number');
    expect((untouched.interceptors.response as unknown as { handlers: unknown[] }).handlers).toHaveLength(1);
  });

  it('returns the same client it was given rather than a copy', () => {
    const client = HttpClient.create();

    expect(disarmResponseInterceptors(client)).toBe(client);
  });

  it('leaves request interceptor registration untouched', () => {
    const client = HttpClient.create();

    disarmResponseInterceptors(client);
    const registered = client.interceptors.request.use(null, jest.fn());

    expect(typeof registered).toBe('number');
    expect((client.interceptors.request as unknown as { handlers: unknown[] }).handlers).toHaveLength(1);
  });
});

describe('createUtilityHttpClient', () => {
  it('builds a fresh disarmed client on every call so interceptors cannot accumulate', () => {
    const first = createUtilityHttpClient() as unknown as HttpClient;
    const second = createUtilityHttpClient() as unknown as HttpClient;

    first.interceptors.response.use(null, jest.fn());
    second.interceptors.response.use(null, jest.fn());

    expect(first).not.toBe(second);
    expect(first.interceptors).not.toBe(second.interceptors);
    expect((first.interceptors.response as unknown as { handlers: unknown[] }).handlers).toEqual([]);
    expect((second.interceptors.response as unknown as { handlers: unknown[] }).handlers).toEqual([]);
  });

  it('returns a client that still carries the utility request builder methods', () => {
    const client = createUtilityHttpClient();

    expect(typeof client.baseUrl).toBe('function');
    expect(typeof client.asJson).toBe('function');
    expect(typeof client.headers).toBe('function');
    expect(typeof client.queryParams).toBe('function');
    expect(typeof client.payload).toBe('function');
    expect(typeof client.send).toBe('function');
  });
});
