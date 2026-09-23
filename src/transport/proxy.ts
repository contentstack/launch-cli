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
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined;
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
    return configured;
  }

  if (typeof configured === 'object' && configured !== null) {
    const { protocol, host, port } = configured as ProxyConfigLike;
    return `${protocol}://${host}:${port}`;
  }

  return environmentProxy() ?? UNNAMED_PROXY;
}
