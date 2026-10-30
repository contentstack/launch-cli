export const CLIENT_EXPOSED_PREFIXES = ['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_'];

export function isClientExposedKey(key: string): boolean {
  return CLIENT_EXPOSED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function clientExposedWarning(key: string): string {
  return (
    `Warning: ${key} starts with a client-exposed prefix, so its value is inlined into client JavaScript ` +
    'at build time and is visible to anyone who loads your site.'
  );
}
