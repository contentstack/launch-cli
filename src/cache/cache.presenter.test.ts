import { purgeInitiatedLines } from './cache.presenter';

const GREEN_OPEN = '\u001b[32m';
const ESCAPE = '\u001b';

describe('cache presenter', () => {
  it('words a path purge as one line naming the path, with no task line, match type or environment', () => {
    const lines = purgeInitiatedLines({ path: { path: '/blog', isPrefix: false, typed: '/blog' } }, false);

    expect(lines).toEqual(['✔ Cache purge initiated for /blog.']);
  });

  it.each([
    ['a typed /blog/*', { path: '/blog', isPrefix: true, typed: '/blog/*' }, '/blog.'],
    ['a typed /*', { path: '/', isPrefix: true, typed: '/*' }, '/.'],
    ['/blog with the prefix option', { path: '/blog', isPrefix: true, typed: '/blog' }, '/blog.'],
    ['a trailing slash', { path: '/blog/', isPrefix: false, typed: '/blog/' }, '/blog/.'],
  ])('names the path without a wildcard for %s', (_label, path, named) => {
    const lines = purgeInitiatedLines({ path }, false);

    expect(lines).toEqual([`✔ Cache purge initiated for ${named}`]);
    expect(lines[0]).not.toContain('/*');
  });

  it.each([
    [['a', 'b'], 'tags: a, b.'],
    [['a'], 'tags: a.'],
  ])('lists the tags %j on one line', (tags, named) => {
    expect(purgeInitiatedLines({ tags }, false)).toEqual([`✔ Cache purge initiated for ${named}`]);
  });

  it.each([
    [['www.example.com'], '1 domain.'],
    [['www.example.com', 'example.com'], '2 domains.'],
    [['a.example.com', 'b.example.com', 'c.example.com'], '3 domains.'],
  ])('counts the hosts %j without naming them', (hosts, named) => {
    const lines = purgeInitiatedLines({ hosts }, false);

    expect(lines).toEqual([`✔ Cache purge initiated for ${named}`]);
    expect(lines[0]).not.toContain('example.com');
  });

  it('draws the single line in green when stdout is a terminal', () => {
    const lines = purgeInitiatedLines({ tags: ['a'] }, true);

    expect(lines).toEqual([`${GREEN_OPEN}✔ Cache purge initiated for tags: a.\u001b[39m`]);
  });

  it('writes no escape code into the line when stdout is not a terminal', () => {
    const lines = purgeInitiatedLines({ tags: ['a'] }, false);

    expect(lines).toHaveLength(1);
    expect(lines.some((line) => line.includes(ESCAPE))).toBe(false);
  });
});
