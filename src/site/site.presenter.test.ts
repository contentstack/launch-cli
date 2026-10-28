import { SITE_URL_NOT_FOUND, siteOpeningLine, siteUrlNotFoundLine } from './site.presenter';

describe('site presenter', () => {
  it('words the opening line with a green tick on a terminal and plain otherwise', () => {
    expect(siteOpeningLine('https://site.example.test', true)).toBe(
      '\u001b[32m✔ Opening https://site.example.test in your browser...\u001b[39m',
    );
    expect(siteOpeningLine('https://site.example.test', false)).toBe(
      '✔ Opening https://site.example.test in your browser...',
    );
  });

  it('words the missing-url line in yellow on a terminal and plain otherwise', () => {
    expect(siteUrlNotFoundLine(true)).toBe('\u001b[33mWebsite URL not found.\u001b[39m');
    expect(siteUrlNotFoundLine(false)).toBe(SITE_URL_NOT_FOUND);
    expect(SITE_URL_NOT_FOUND).toBe('Website URL not found.');
  });
});
