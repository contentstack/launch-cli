import type { CachePath } from '../../../cache/types';
import type { UxLike } from '../../../core/prompt';
import Purge from './purge';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const BLOG: CachePath = { path: '/blog', isPrefix: false, typed: '/blog' };
const CRITERIA = ['--path', '--tags', '--hosts'];
const ONE_OF = `Pass exactly one of ${CRITERIA.join(', ')}`;
const TASK_LINE = '→ CDN cache revalidation task initiated.';

interface Harness {
  resolved?: Record<string, unknown>;
  environment?: { uid?: string; name?: string };
  getFails?: Error;
  purgeFails?: Error;
  purgeResult?: unknown;
  outputIsTTY?: boolean;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const calls: string[] = [];
  const got: unknown[] = [];
  const purged: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const command = Object.create(Purge.prototype) as Purge;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1', path: BLOG, ...harness.resolved },
    services: {
      ux,
      isTTY: false,
      outputIsTTY: harness.outputIsTTY ?? false,
      api: {
        environments: {
          get: async (params: unknown) => {
            calls.push('get');
            got.push(params);

            if (harness.getFails) {
              throw harness.getFails;
            }

            return 'environment' in harness ? harness.environment : { uid: 'env1', name: 'production' };
          },
        },
        cache: {
          purge: async (params: unknown) => {
            calls.push('purge');
            purged.push(params);

            if (harness.purgeFails) {
              throw harness.purgeFails;
            }

            return harness.purgeResult;
          },
        },
      },
    },
  });

  return { command, lines, calls, got, purged };
}

describe('launch:cache:purge', () => {
  it('reads the environment, then purges the path and says what was purged in the environment named', async () => {
    const { command, lines, calls, got, purged } = commandUnderTest({
      resolved: { path: { path: '/blog', isPrefix: true, typed: '/blog/*' } },
    });

    await command.run();

    expect(calls).toEqual(['get', 'purge']);
    expect(got).toEqual([SCOPE]);
    expect(purged).toEqual([{ ...SCOPE, criterion: { cachePath: { path: '/blog', isPrefix: true } } }]);
    expect(lines).toEqual([
      '✔ Cache purge initiated for path /blog/* (prefix match) in environment "production".',
      TASK_LINE,
    ]);
  });

  it('purges tags as cacheTags', async () => {
    const { command, lines, purged } = commandUnderTest({ resolved: { path: undefined, tags: ['a', 'b'] } });

    await command.run();

    expect(purged).toEqual([{ ...SCOPE, criterion: { cacheTags: ['a', 'b'] } }]);
    expect(lines[0]).toBe('✔ Cache purge initiated for tags a, b in environment "production".');
  });

  it('purges hosts as hostnames', async () => {
    const { command, lines, purged } = commandUnderTest({ resolved: { path: undefined, hosts: ['example.com'] } });

    await command.run();

    expect(purged).toEqual([{ ...SCOPE, criterion: { hostnames: ['example.com'] } }]);
    expect(lines[0]).toBe('✔ Cache purge initiated for hosts example.com in environment "production".');
  });

  it('prints the same two lines whatever the success body says', async () => {
    const empty = commandUnderTest({ purgeResult: {} });
    const other = commandUnderTest({ purgeResult: { message: 'something else' } });

    await empty.command.run();
    await other.command.run();

    expect(empty.lines).toEqual(other.lines);
    expect(empty.lines).toEqual([
      '✔ Cache purge initiated for path /blog (exact match) in environment "production".',
      TASK_LINE,
    ]);
  });

  it('colours the success line only when stdout is a terminal', async () => {
    const terminal = commandUnderTest({ outputIsTTY: true });
    const piped = commandUnderTest({ outputIsTTY: false });

    await terminal.command.run();
    await piped.command.run();

    expect(terminal.lines[0]).toContain('\u001b[32m');
    expect(piped.lines.join('')).not.toContain('\u001b');
  });

  it.each([
    ['has no name', { uid: 'env1' }],
    ['has an empty name', { uid: 'env1', name: '' }],
    ['has a blank name', { uid: 'env1', name: '   ' }],
  ])('falls back to the --env value as typed when the environment %s', async (_label, environment) => {
    const { command, lines } = commandUnderTest({ resolved: { env: 'env1' }, environment });

    await command.run();

    expect(lines[0]).toBe('✔ Cache purge initiated for path /blog (exact match) in environment "env1".');
    expect(lines.join('')).not.toContain('undefined');
  });

  it('propagates a failed environment lookup without purging or printing anything', async () => {
    const failure = new Error('lookup exploded');
    const { command, lines, calls } = commandUnderTest({ getFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(calls).toEqual(['get']);
    expect(lines).toEqual([]);
  });

  it('propagates a failed purge rather than reporting a success', async () => {
    const failure = new Error('purge exploded');
    const { command, lines, calls } = commandUnderTest({ purgeFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(calls).toEqual(['get', 'purge']);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required, the three criteria as optional, and the exactlyOneOf rule', () => {
    expect(Purge.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      path: {},
      tags: {},
      hosts: {},
    });
    expect(Object.entries(Purge.flags).map(([flag]) => flag).sort()).toEqual([
      'env',
      'hosts',
      'org',
      'path',
      'project',
      'tags',
    ]);
    expect(Purge.rules).toHaveLength(1);
  });

  it('refuses none, two and three criteria through its rule', () => {
    const [rule] = Purge.rules ?? [];
    const supplied = { path: 'flag', tags: 'flag', hosts: 'flag' } as const;

    expect(() => rule({}, {})).toThrow(`${ONE_OF}; none was supplied.`);
    expect(() => rule({ path: BLOG, tags: ['a'] }, supplied)).toThrow(`${ONE_OF}; --path, --tags were supplied.`);
    expect(() => rule({ path: BLOG, tags: ['a'], hosts: ['h'] }, supplied)).toThrow(
      `${ONE_OF}; --path, --tags, --hosts were supplied.`,
    );
    expect(() => rule({ tags: ['a'] }, supplied)).not.toThrow();
  });
});
