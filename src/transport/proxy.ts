import { configHandler } from '@contentstack/cli-utilities';

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
