import type { UxLike } from '../core/prompt';
import { CancelledError } from '../core/errors';
import { domainChoices, askForDomain } from './site.prompt';

const DEFAULT_URL = 'https://my-site.contentstackapps.com';

describe('domainChoices', () => {
  it('lists the default url first, labelled (default), then each domain by hostname with its url as the value', () => {
    const choices = domainChoices(DEFAULT_URL, [{ url: 'https://www.example.com' }, { url: 'shop.example.com' }]);

    expect(choices).toEqual([
      { name: 'my-site.contentstackapps.com (default)', value: DEFAULT_URL },
      { name: 'www.example.com', value: 'https://www.example.com' },
      { name: 'shop.example.com', value: 'https://shop.example.com' },
    ]);
  });

  it('collapses domains that differ only by scheme, case or trailing slash, keeping the default as the first occurrence', () => {
    const choices = domainChoices(DEFAULT_URL, [
      { url: 'http://MY-SITE.contentstackapps.com/' },
      { url: 'https://www.example.com' },
      { url: 'WWW.Example.com//' },
      { url: 'http://www.example.com' },
    ]);

    expect(choices).toEqual([
      { name: 'my-site.contentstackapps.com (default)', value: DEFAULT_URL },
      { name: 'www.example.com', value: 'https://www.example.com' },
    ]);
  });

  it.each([[undefined], [[]]])('returns only the default url for domains %p', (domains) => {
    expect(domainChoices(DEFAULT_URL, domains)).toEqual([
      { name: 'my-site.contentstackapps.com (default)', value: DEFAULT_URL },
    ]);
  });

  it('skips domains with no, null, empty or blank url', () => {
    const domains = [
      {},
      { url: undefined },
      { url: null },
      { url: '' },
      { url: '   ' },
      { url: 'https://' },
      { url: 'a.example.com' },
    ];

    const choices = domainChoices(DEFAULT_URL, domains as { url?: string }[]);

    expect(choices).toEqual([
      { name: 'my-site.contentstackapps.com (default)', value: DEFAULT_URL },
      { name: 'a.example.com', value: 'https://a.example.com' },
    ]);
    expect(choices.some((choice) => choice.name === '' || choice.value === 'https://')).toBe(false);
  });

  it('keeps http:// and https:// as given, adds https:// to a bare host and names every choice by its bare host', () => {
    const choices = domainChoices(DEFAULT_URL, [
      { url: 'http://plain.example.test' },
      { url: 'https://secure.example.test/' },
      { url: 'bare.example.test' },
    ]);

    expect(choices.slice(1)).toEqual([
      { name: 'plain.example.test', value: 'http://plain.example.test' },
      { name: 'secure.example.test', value: 'https://secure.example.test' },
      { name: 'bare.example.test', value: 'https://bare.example.test' },
    ]);
  });

  it('does not filter a domain by any other field', () => {
    const choices = domainChoices(DEFAULT_URL, [
      { url: 'a.example.com', createdAt: '2025-01-01T00:00:00.000Z' } as { url: string },
      { url: 'b.example.com' },
    ]);

    expect(choices.map((choice) => choice.name)).toEqual([
      'my-site.contentstackapps.com (default)',
      'a.example.com',
      'b.example.com',
    ]);
  });
});

describe('askForDomain', () => {
  it('asks a single-select list with the default preselected and returns the picked value', async () => {
    const payloads: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async <T>(payload: unknown) => {
        payloads.push(payload);
        return 'https://www.example.com' as T;
      },
    };
    const choices = domainChoices(DEFAULT_URL, [{ url: 'www.example.com' }]);

    const picked = await askForDomain(ux, choices);

    expect(picked).toBe('https://www.example.com');
    expect(payloads).toEqual([
      {
        type: 'list',
        name: 'value',
        message: 'Which domain do you want to open?',
        choices,
        default: DEFAULT_URL,
        loop: false,
        pageSize: 2,
      },
    ]);
  });

  it('raises a CancelledError when nothing is chosen', async () => {
    const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

    await expect(askForDomain(ux, domainChoices(DEFAULT_URL, [{ url: 'a.example.com' }]))).rejects.toBeInstanceOf(
      CancelledError,
    );
  });
});
