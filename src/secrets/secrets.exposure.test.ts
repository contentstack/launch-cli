import { CLIENT_EXPOSED_PREFIXES, clientExposedWarning, isClientExposedKey } from './secrets.exposure';

describe('client-exposed secret keys', () => {
  it('lists the five public prefixes', () => {
    expect(CLIENT_EXPOSED_PREFIXES).toEqual(['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_']);
  });

  it.each(['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_'])(
    'treats a key starting with %s as client-exposed and warns about it by name',
    (prefix) => {
      const key = `${prefix}API_URL`;

      expect(isClientExposedKey(key)).toBe(true);
      expect(clientExposedWarning(key)).toBe(
        `Warning: ${key} starts with a client-exposed prefix, so its value is inlined into client JavaScript ` +
          'at build time and is visible to anyone who loads your site.',
      );
    },
  );

  it.each(['API_TOKEN', 'MY_NEXT_PUBLIC_X', 'next_public_x', 'PUBLIC', 'VITEX'])(
    'does not treat %s as client-exposed',
    (key) => {
      expect(isClientExposedKey(key)).toBe(false);
    },
  );
});
