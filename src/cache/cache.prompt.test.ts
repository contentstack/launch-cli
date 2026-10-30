import type { UxLike } from '../core/prompt';
import { domainHostnames, promptForCriterion } from './cache.prompt';

type Answer = unknown | ((payload: Record<string, unknown>) => unknown);

function asker(...answers: Answer[]) {
  const payloads: Record<string, unknown>[] = [];
  const queue = [...answers];
  const ux: UxLike = {
    print: () => undefined,
    inquire: async <T>(payload: unknown): Promise<T> => {
      payloads.push(payload as Record<string, unknown>);

      if (queue.length === 0) {
        throw new Error(`Unexpected prompt: ${String((payload as Record<string, unknown>).message)}`);
      }

      const next = queue.shift();

      return (typeof next === 'function' ? next(payload as Record<string, unknown>) : next) as T;
    },
  };

  return { ux, payloads };
}

function validatorOf(payload: Record<string, unknown>): (value: unknown) => unknown {
  return payload.validate as (value: unknown) => unknown;
}

const DOMAINS = ['example.com', 'www.example.com'];

describe('promptForCriterion', () => {
  it('asks what to purge as a list of Path, Cache tags and Hostnames, and only the chosen follow-up', async () => {
    const { ux, payloads } = asker('tags', 'a, b');

    const target = await promptForCriterion(ux, DOMAINS);

    expect(target).toEqual({ tags: ['a', 'b'] });
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      type: 'list',
      message: 'What do you want to purge?',
      choices: [
        { name: 'Path', value: 'path' },
        { name: 'Cache tags', value: 'tags' },
        { name: 'Hostnames', value: 'hosts' },
      ],
      loop: false,
    });
    expect(payloads[1]).toMatchObject({ type: 'input', message: 'Cache tags to purge (comma-separated)' });
  });

  it('asks the path, then the prefix confirmation defaulting to no, and keeps the answer', async () => {
    const { ux, payloads } = asker('path', ' /blog ', true);

    const target = await promptForCriterion(ux, DOMAINS);

    expect(target).toEqual({ path: { path: '/blog', isPrefix: true, typed: '/blog' } });
    expect(payloads.map((payload) => payload.message)).toEqual([
      'What do you want to purge?',
      'Path to purge (for example /blog)',
      'Purge everything under this path? (prefix match)',
    ]);
    expect(payloads[2]).toMatchObject({ type: 'confirm', default: false });
  });

  it('sends an exact path when the prefix confirmation is declined', async () => {
    const { ux } = asker('path', '/blog', false);

    expect(await promptForCriterion(ux, DOMAINS)).toEqual({ path: { path: '/blog', isPrefix: false, typed: '/blog' } });
  });

  it.each([
    ['/blog/*', '/blog'],
    ['/*', '/'],
  ])('for the path %s does not ask the prefix question and sends a prefix match', async (typed, path) => {
    const { ux, payloads } = asker('path', typed);

    const target = await promptForCriterion(ux, DOMAINS);

    expect(target).toEqual({ path: { path, isPrefix: true, typed } });
    expect(payloads).toHaveLength(2);
  });

  it('asks the prefix question for the root path /', async () => {
    const { ux, payloads } = asker('path', '/', true);

    expect(await promptForCriterion(ux, DOMAINS)).toEqual({ path: { path: '/', isPrefix: true, typed: '/' } });
    expect(payloads).toHaveLength(3);
  });

  it('refuses a path that does not start with a slash inside the prompt, as a message and not an error', async () => {
    const { ux, payloads } = asker('path', '/blog', false);

    await promptForCriterion(ux, DOMAINS);
    const validate = validatorOf(payloads[1]);

    for (const bad of ['blog', 'https://example.com/blog', '', '   ', '*']) {
      expect(typeof validate(bad)).toBe('string');
    }

    for (const good of ['/blog', '/', '/*', '  /blog  ']) {
      expect(validate(good)).toBe(true);
    }
  });

  it('refuses tags that are empty once cleaned inside the prompt and accepts any count of tags', async () => {
    const { ux, payloads } = asker('tags', 'a');

    await promptForCriterion(ux, DOMAINS);
    const validate = validatorOf(payloads[1]);

    expect(typeof validate(',')).toBe('string');
    expect(typeof validate('')).toBe('string');
    expect(validate('a')).toBe(true);
    expect(validate(Array.from({ length: 101 }, (_unused, index) => `t${index}`).join(','))).toBe(true);
  });

  it('cleans the tags with the --tags rules', async () => {
    const { ux } = asker('tags', ' b , a ,, b ');

    expect(await promptForCriterion(ux, DOMAINS)).toEqual({ tags: ['b', 'a'] });
  });

  it('offers the environment domains as a checkbox that needs at least one pick', async () => {
    const { ux, payloads } = asker('hosts', ['www.example.com']);

    const target = await promptForCriterion(ux, DOMAINS);

    expect(target).toEqual({ hosts: ['www.example.com'] });
    expect(payloads[1]).toMatchObject({
      type: 'checkbox',
      choices: [
        { name: 'example.com', value: 'example.com' },
        { name: 'www.example.com', value: 'www.example.com' },
      ],
      loop: false,
    });
    expect(typeof validatorOf(payloads[1])([])).toBe('string');
    expect(validatorOf(payloads[1])(['example.com'])).toBe(true);
  });

  it('still asks a checkbox for a single domain', async () => {
    const { ux, payloads } = asker('hosts', ['example.com']);

    expect(await promptForCriterion(ux, ['example.com'])).toEqual({ hosts: ['example.com'] });
    expect(payloads[1]).toMatchObject({ type: 'checkbox', choices: [{ name: 'example.com', value: 'example.com' }] });
  });

  it.each([[[]], [undefined as unknown as string[]]])(
    'leaves Hostnames out of the list when the environment has no domain (%p)',
    async (domains) => {
      const { ux, payloads } = asker('path', '/blog', false);

      await promptForCriterion(ux, domains ?? []);

      expect(payloads[0].choices).toEqual([
        { name: 'Path', value: 'path' },
        { name: 'Cache tags', value: 'tags' },
      ]);
    },
  );

  it('throws the framework cancellation when the criterion is not answered', async () => {
    const { ux } = asker(undefined);

    await expect(promptForCriterion(ux, DOMAINS)).rejects.toMatchObject({ exitCode: 3 });
  });
});

describe('domainHostnames', () => {
  it('strips the scheme and trailing slash and keeps only the host', () => {
    expect(
      domainHostnames([{ url: 'https://example.com' }, { url: 'http://www.example.com/' }, { url: ' https://a.b.test// ' }]),
    ).toEqual(['example.com', 'www.example.com', 'a.b.test']);
  });

  it('skips entries without a usable url and duplicates', () => {
    expect(
      domainHostnames([{ url: 'https://example.com' }, {}, { url: '' }, { url: '   ' }, { url: 'https://example.com/' }]),
    ).toEqual(['example.com']);
  });

  it('is empty when the environment lists no domains', () => {
    expect(domainHostnames(undefined)).toEqual([]);
    expect(domainHostnames([])).toEqual([]);
  });
});
