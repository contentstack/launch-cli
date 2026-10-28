import { UsageError } from '../core/errors';
import type { ResolveServices } from '../core/resolution';
import { resolveInputsTraced } from '../core/resolve';
import { exactlyOneOf } from '../core/rules';
import { inputs } from '../core/inputs';
import type { UxLike } from '../core/prompt';
import type { ApiSurface } from '../resources';
import { cacheFlags, cacheResolution, criterionOf } from './cache.inputs';

function services(): ResolveServices {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api: {} as ApiSurface, ux, isTTY: false };
}

function normalize(flag: 'path' | 'tags' | 'hosts', value: string): Promise<unknown> {
  const spec = cacheResolution[flag] as { normalize(value: string, args: unknown): Promise<unknown> };

  return spec.normalize(value, { services: services(), resolved: {}, source: 'flag' });
}

const purgeInputs = inputs({ path: {}, tags: {}, hosts: {} });

describe('cache inputs', () => {
  it('names the three purge criteria and declares none of them required', () => {
    expect(Object.entries(cacheFlags).map(([flag]) => flag)).toEqual(['path', 'tags', 'hosts']);
    for (const flag of Object.values(cacheFlags)) {
      expect((flag as { required?: boolean }).required).toBeFalsy();
    }
  });

  it('gives no criterion a default or a prompt, so exactlyOneOf only ever sees what the user supplied', () => {
    for (const spec of Object.values(cacheResolution)) {
      expect(spec).not.toHaveProperty('default');
      expect(spec).not.toHaveProperty('prompt');
    }
  });

  it('treats an exact path as not a prefix and keeps it as typed', async () => {
    expect(await normalize('path', '/blog')).toEqual({ path: '/blog', isPrefix: false, typed: '/blog' });
  });

  it('strips a trailing /* into a prefix match and keeps the typed form for the success line', async () => {
    expect(await normalize('path', '/blog/*')).toEqual({ path: '/blog', isPrefix: true, typed: '/blog/*' });
  });

  it('turns /* alone into the root prefix rather than an empty path', async () => {
    expect(await normalize('path', '/*')).toEqual({ path: '/', isPrefix: true, typed: '/*' });
  });

  it('trims the path before reading it', async () => {
    expect(await normalize('path', '  /blog/*  ')).toEqual({ path: '/blog', isPrefix: true, typed: '/blog/*' });
  });

  it('leaves a trailing slash that is not a wildcard in the path', async () => {
    expect(await normalize('path', '/blog/')).toEqual({ path: '/blog/', isPrefix: false, typed: '/blog/' });
  });

  it.each(['blog', 'blog/*', '*', 'https://example.com/blog'])(
    'rejects the path %s because it does not start with a slash',
    async (value) => {
      const error = await normalize('path', value).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).exitCode).toBe(2);
      expect((error as UsageError).message).toBe(`--path must start with "/"; "${value}" does not.`);
    },
  );

  it('splits tags on commas, trimming and dropping empties and duplicates', async () => {
    expect(await normalize('tags', 'a,b,a,')).toEqual(['a', 'b']);
  });

  it('keeps the first-seen order of tags rather than sorting them', async () => {
    expect(await normalize('tags', ' b , a ,, b ')).toEqual(['b', 'a']);
  });

  it('normalises hosts the same way', async () => {
    expect(await normalize('hosts', 'www.example.com, example.com,www.example.com,')).toEqual([
      'www.example.com',
      'example.com',
    ]);
  });

  it.each([
    ['tags', ','],
    ['tags', ' , ,'],
    ['hosts', ','],
    ['hosts', ' , ,'],
  ] as const)('rejects --%s %j because nothing is left once it is cleaned', async (flag, value) => {
    const error = await normalize(flag, value).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(2);
    expect((error as UsageError).message).toBe(`--${flag} must name at least one value; "${value}" names none.`);
  });

  it.each([
    ['   ', 'a'],
    ['', 'a'],
  ])('reads a blank --path %j as absent, so --tags alone satisfies exactlyOneOf', async (path, tags) => {
    const { resolved, sources } = await resolveInputsTraced(purgeInputs, {
      parsed: { path, tags },
      projectConfig: {},
      services: services(),
      rules: [exactlyOneOf('path', 'tags', 'hosts')],
    });

    expect(resolved.path).toBeUndefined();
    expect(sources.path).toBeUndefined();
    expect(resolved.tags).toEqual(['a']);
  });
});

describe('criterionOf', () => {
  it('sends a path as the cachePath object without its typed form', () => {
    expect(criterionOf({ path: { path: '/blog', isPrefix: true, typed: '/blog/*' } })).toEqual({
      cachePath: { path: '/blog', isPrefix: true },
    });
  });

  it('sends tags as cacheTags and nothing else', () => {
    expect(criterionOf({ tags: ['a', 'b'] })).toStrictEqual({ cacheTags: ['a', 'b'] });
  });

  it('sends hosts as hostnames and nothing else', () => {
    expect(criterionOf({ hosts: ['example.com'] })).toStrictEqual({ hostnames: ['example.com'] });
  });
});
