const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const TRAILING_SLASHES = /\/+$/;

export function bareHost(url: string): string {
  return url.trim().replace(SCHEME, '').replace(TRAILING_SLASHES, '');
}

export function withScheme(url: string): string {
  const trimmed = url.trim().replace(TRAILING_SLASHES, '');

  return SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
}
