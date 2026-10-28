import { purgeInitiatedLines } from './cache.presenter';

const GREEN_OPEN = '\u001b[32m';
const ESCAPE = '\u001b';
const TASK_LINE = '→ CDN cache revalidation task initiated.';

describe('cache presenter', () => {
  it('names a prefix path as the user typed it, the match type and the environment', () => {
    const lines = purgeInitiatedLines(
      { path: { path: '/blog', isPrefix: true, typed: '/blog/*' } },
      'production',
      false,
    );

    expect(lines).toEqual([
      '✔ Cache purge initiated for path /blog/* (prefix match) in environment "production".',
      TASK_LINE,
    ]);
  });

  it('calls a path without a wildcard an exact match', () => {
    const lines = purgeInitiatedLines({ path: { path: '/blog', isPrefix: false, typed: '/blog' } }, 'production', false);

    expect(lines).toEqual(['✔ Cache purge initiated for path /blog (exact match) in environment "production".', TASK_LINE]);
  });

  it('lists the tags purged', () => {
    expect(purgeInitiatedLines({ tags: ['a', 'b'] }, 'production', false)).toEqual([
      '✔ Cache purge initiated for tags a, b in environment "production".',
      TASK_LINE,
    ]);
  });

  it('lists the hosts purged', () => {
    expect(purgeInitiatedLines({ hosts: ['www.example.com', 'example.com'] }, 'staging', false)).toEqual([
      '✔ Cache purge initiated for hosts www.example.com, example.com in environment "staging".',
      TASK_LINE,
    ]);
  });

  it('draws only the success line, in green, when stdout is a terminal', () => {
    const lines = purgeInitiatedLines({ tags: ['a'] }, 'production', true);

    expect(lines[0]).toBe(`${GREEN_OPEN}✔ Cache purge initiated for tags a in environment "production".\u001b[39m`);
    expect(lines[1]).toBe(TASK_LINE);
  });

  it('writes no escape code into either line when stdout is not a terminal', () => {
    const lines = purgeInitiatedLines({ tags: ['a'] }, 'production', false);

    expect(lines.some((line) => line.includes(ESCAPE))).toBe(false);
  });
});
