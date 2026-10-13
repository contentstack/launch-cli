import { configHandler } from '@contentstack/cli-utilities';
import { getProxyConfigForHost } from '@contentstack/cli-utilities/lib/proxy-helper';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';

const UNNAMED_PROXY = 'proxy server';

interface ProxyConfigLike {
  protocol?: string;
  host?: string;
  port?: number;
}

function configuredProxy(): unknown {
  return configHandler.get('proxy');
}

function environmentProxy(): string | undefined {
  const { HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy } = process.env;

  return HTTPS_PROXY || https_proxy || HTTP_PROXY || http_proxy || undefined;
}

export function withoutCredentials(url: string): string {
  return url.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/)?)[^@/]*@/i, '$1');
}

export function hasProxy(): boolean {
  return Boolean(configuredProxy()) || Boolean(environmentProxy());
}

export function proxyUrl(): string | undefined {
  if (!hasProxy()) {
    return undefined;
  }

  const configured = configuredProxy();

  if (typeof configured === 'string' && configured !== '') {
    return withoutCredentials(configured);
  }

  if (typeof configured === 'object' && configured !== null) {
    const { protocol, host, port } = configured as ProxyConfigLike;
    return `${protocol}://${host}:${port}`;
  }

  const fromEnvironment = environmentProxy();

  return fromEnvironment === undefined ? UNNAMED_PROXY : withoutCredentials(fromEnvironment);
}

export function proxyFailureMessage(address: string): string {
  return `Proxy error: Unable to connect to proxy server at ${address}. Please verify your proxy configuration.`;
}

export interface ProxyRoute {
  agent: Agent;
  address: string;
}

export function proxyRouteFor(url: string): ProxyRoute | undefined {
  const proxy = getProxyConfigForHost(new URL(url).hostname);

  if (proxy === undefined) {
    return undefined;
  }

  const { protocol, host, port, auth } = proxy;
  const credentials = auth === undefined ? undefined : `${auth.username}:${auth.password}`;

  return {
    // agent-base 6 is typed as an EventEmitter, but Node only needs the addRequest it implements.
    agent: new HttpsProxyAgent({ protocol, host, port, auth: credentials }) as unknown as Agent,
    address: `${protocol}://${host}:${port}`,
  };
}
