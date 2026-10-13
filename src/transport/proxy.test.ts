import { randomBytes } from 'node:crypto';

import { configHandler } from '@contentstack/cli-utilities';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request } from 'node:https';
import type { Agent } from 'node:http';

import { hasProxy, proxyRouteFor, proxyUrl } from './proxy';

const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy'];
const STORAGE_URL = 'https://storage.example.test/bucket/project.zip';

function login(): { user: string; phrase: string } {
  return { user: `u${randomBytes(4).toString('hex')}`, phrase: randomBytes(12).toString('hex') };
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of PROXY_VARIABLES) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PROXY_VARIABLES) {
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

  it.each(['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'])(
    'reads a proxy from %s and never returns the credentials embedded in it',
    (variable) => {
      const { user, phrase } = login();
      process.env[variable] = `http://${user}:${phrase}@proxy.internal:3128`;

      const url = proxyUrl();

      expect(hasProxy()).toBe(true);
      expect(url).toBe('http://proxy.internal:3128');
      expect(url).not.toContain(user);
      expect(url).not.toContain(phrase);
    },
  );

  it('strips credentials from a configured string form too', () => {
    const { user, phrase } = login();
    configuredProxy(`https://${user}:${phrase}@corp.internal:443/`);

    expect(proxyUrl()).toBe('https://corp.internal:443/');
  });

  it('strips a user name that has no colon part', () => {
    const { user } = login();
    process.env.HTTPS_PROXY = `http://${user}@proxy.internal:3128`;

    expect(proxyUrl()).toBe('http://proxy.internal:3128');
  });

  it('strips credentials even from a value that is not a parseable URL', () => {
    const { user, phrase } = login();
    process.env.HTTPS_PROXY = `${user}:${phrase}@proxy.internal:3128`;

    const url = proxyUrl();

    expect(url).toBe('proxy.internal:3128');
    expect(url).not.toContain(phrase);
  });

  it('leaves an @ that appears after the host alone', () => {
    process.env.HTTPS_PROXY = 'http://proxy.internal:3128/path@segment';

    expect(proxyUrl()).toBe('http://proxy.internal:3128/path@segment');
  });

  it('prefers the uppercase variable when both spellings are set', () => {
    process.env.HTTPS_PROXY = 'http://upper.internal:3128';
    process.env.https_proxy = 'http://lower.internal:3128';

    expect(proxyUrl()).toBe('http://upper.internal:3128');
  });

  it('names an unnameable proxy rather than claiming there is none', () => {
    configuredProxy(true);

    expect(hasProxy()).toBe(true);
    expect(proxyUrl()).toBe('proxy server');
  });
});

interface RecordingProxy {
  url: string;
  port: number;
  authorisations: (string | undefined)[];
  close(): Promise<string[]>;
}

async function recordingProxy(): Promise<RecordingProxy> {
  const seen: string[] = [];
  const authorisations: (string | undefined)[] = [];
  const server = createServer();
  server.on('connect', (req, socket) => {
    seen.push(`${req.method} ${req.url}`);
    authorisations.push(req.headers['proxy-authorization']);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    authorisations,
    close: () => new Promise((resolve) => server.close(() => resolve(seen))),
  };
}

function reachThrough(agent: Agent | undefined): Promise<void> {
  return new Promise((resolve) => {
    request(STORAGE_URL, { agent }, () => resolve()).on('error', () => resolve()).end();
  });
}

describe('proxyRouteFor', () => {
  it('gives no agent when no proxy is configured, so the request connects directly', () => {
    configuredProxy(undefined);

    expect(proxyRouteFor(STORAGE_URL)).toBeUndefined();
  });

  it('tunnels through the proxy HTTPS_PROXY names', async () => {
    configuredProxy(undefined);
    const proxy = await recordingProxy();
    process.env.HTTPS_PROXY = proxy.url;

    await reachThrough(proxyRouteFor(STORAGE_URL)?.agent);

    expect(await proxy.close()).toEqual(['CONNECT storage.example.test:443']);
  });

  it('connects directly when NO_PROXY lists the storage host, even with a proxy configured', () => {
    configuredProxy(undefined);
    process.env.HTTPS_PROXY = 'http://proxy.internal:3128';
    process.env.NO_PROXY = '.example.test';

    expect(proxyRouteFor(STORAGE_URL)).toBeUndefined();
  });

  it('prefers the configured proxy over HTTPS_PROXY and authenticates with its credentials', async () => {
    const { user, phrase } = login();
    const proxy = await recordingProxy();
    configuredProxy({ protocol: 'http', host: '127.0.0.1', port: proxy.port, auth: { username: user, password: phrase } });
    process.env.HTTPS_PROXY = 'http://ignored.internal:3128';

    await reachThrough(proxyRouteFor(STORAGE_URL)?.agent);

    expect(await proxy.close()).toEqual(['CONNECT storage.example.test:443']);
    expect(proxy.authorisations).toEqual([`Basic ${Buffer.from(`${user}:${phrase}`).toString('base64')}`]);
  });
});
