import { configHandler } from '@contentstack/cli-utilities';

import { hasProxy, proxyUrl } from './proxy';

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY'];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of PROXY_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PROXY_ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  jest.restoreAllMocks();
});

function configuredProxy(value: unknown) {
  return jest.spyOn(configHandler, 'get').mockImplementation((key: string) => (key === 'proxy' ? value : undefined));
}

describe('hasProxy', () => {
  it('is false when neither the config nor the environment names a proxy', () => {
    configuredProxy(undefined);

    expect(hasProxy()).toBe(false);
    expect(proxyUrl()).toBeUndefined();
  });

  it.each([[null], [''], [false], [0]])('treats a %p config value as no proxy at all', (value) => {
    configuredProxy(value);

    expect(hasProxy()).toBe(false);
    expect(proxyUrl()).toBeUndefined();
  });

  it('is true when HTTPS_PROXY is set', () => {
    configuredProxy(undefined);
    process.env.HTTPS_PROXY = 'http://proxy.internal:3128';

    expect(hasProxy()).toBe(true);
    expect(proxyUrl()).toBe('http://proxy.internal:3128');
  });

  it('falls back to HTTP_PROXY when HTTPS_PROXY is unset', () => {
    configuredProxy(undefined);
    process.env.HTTP_PROXY = 'http://plain.internal:8080';

    expect(hasProxy()).toBe(true);
    expect(proxyUrl()).toBe('http://plain.internal:8080');
  });
});

describe('proxyUrl', () => {
  it('renders the configured object form as protocol, host and port', () => {
    configuredProxy({ protocol: 'http', host: 'corp.internal', port: 3128 });

    expect(proxyUrl()).toBe('http://corp.internal:3128');
  });

  it('returns a configured string form unchanged', () => {
    configuredProxy('http://corp.internal:3128');

    expect(proxyUrl()).toBe('http://corp.internal:3128');
  });

  it('prefers the configured proxy over the environment', () => {
    configuredProxy({ protocol: 'https', host: 'corp.internal', port: 443 });
    process.env.HTTPS_PROXY = 'http://ignored.internal:3128';

    expect(proxyUrl()).toBe('https://corp.internal:443');
  });

  it('names an unnameable proxy rather than claiming there is none', () => {
    configuredProxy(true);

    expect(hasProxy()).toBe(true);
    expect(proxyUrl()).toBe('proxy server');
  });
});
