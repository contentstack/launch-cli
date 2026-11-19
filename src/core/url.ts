const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const WEB_SCHEME = /^https?:\/\//i;
const TRAILING_SLASHES = /\/+$/;

export function bareHost(url: string): string {
  return url.trim().replace(SCHEME, '').replace(TRAILING_SLASHES, '');
}

export function webUrlOf(raw: string | undefined): string | undefined {
  const url = raw?.trim() ?? '';
  const host = bareHost(url);
  const scheme = SCHEME.exec(url)?.[0];

  if (host === '' || (scheme !== undefined && !WEB_SCHEME.test(scheme))) {
    return undefined;
  }

  const rest = host.includes('/') ? url.slice(scheme?.length ?? 0) : host;

  return `${scheme ?? 'https://'}${rest}`;
}
