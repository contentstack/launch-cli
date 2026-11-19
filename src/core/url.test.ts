import { bareHost, webUrlOf } from './url';

describe('webUrlOf', () => {
  it.each([
    ['http://plain.example.test', 'http://plain.example.test'],
    ['  https://secure.example.test  ', 'https://secure.example.test'],
    ['bare.example.test', 'https://bare.example.test'],
    ['http-api-ab12.contentstackapps.com', 'https://http-api-ab12.contentstackapps.com'],
  ])('keeps a web scheme as given and gives a bare host https://: %p', (raw, url) => {
    expect(webUrlOf(raw)).toBe(url);
  });

  it.each([
    ['https://host.example.test/app/', 'https://host.example.test/app/'],
    ['https://host.example.test/?next=/', 'https://host.example.test/?next=/'],
    ['host.example.test/app/', 'https://host.example.test/app/'],
    ['https://host.example.test//', 'https://host.example.test'],
    ['host.example.test/', 'https://host.example.test'],
  ])('keeps a path or query exactly and drops trailing slashes only from a bare host: %p', (raw, url) => {
    expect(webUrlOf(raw)).toBe(url);
  });

  it.each([[undefined], [''], ['   '], ['/'], ['//'], ['https://'], ['file:///etc/hosts'], ['ftp://files.example.test']])(
    'gives no url for %p, which has no host or is not a web url',
    (raw) => {
      expect(webUrlOf(raw)).toBeUndefined();
    },
  );
});

describe('bareHost', () => {
  it('drops the scheme and trailing slashes', () => {
    expect(bareHost(' HTTPS://www.example.com// ')).toBe('www.example.com');
  });
});
