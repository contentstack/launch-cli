import { randomBytes } from 'node:crypto';

import type { CachePath } from '../../../cache/types';
import { EXIT_RUNTIME, EXIT_USAGE } from '../../../core/constants';
import { UsageError } from '../../../core/errors';
import { LaunchApiError } from '../../../transport/errors';
import type { UxLike } from '../../../core/prompt';
import Purge from './purge';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const BLOG: CachePath = { path: '/blog', isPrefix: false, typed: '/blog' };
const CRITERIA = ['--path', '--tags', '--hosts'];
const ONE_OF = `Pass exactly one of ${CRITERIA.join(', ')}`;

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
  it('reads the environment, then purges the path and says what was purged on one line', async () => {
    const { command, lines, calls, got, purged } = commandUnderTest({
      resolved: { path: { path: '/blog', isPrefix: true, typed: '/blog/*' } },
    });

    await command.run();

    expect(calls).toEqual(['get', 'purge']);
    expect(got).toEqual([SCOPE]);
    expect(purged).toEqual([{ ...SCOPE, criterion: { cachePath: { path: '/blog', isPrefix: true } } }]);
    expect(lines).toEqual(['✔ Cache purge initiated for /blog.']);
  });

  it('purges tags as cacheTags', async () => {
    const { command, lines, purged } = commandUnderTest({ resolved: { path: undefined, tags: ['a', 'b'] } });

    await command.run();

    expect(purged).toEqual([{ ...SCOPE, criterion: { cacheTags: ['a', 'b'] } }]);
    expect(lines[0]).toBe('✔ Cache purge initiated for tags: a, b.');
  });

  it('purges hosts as hostnames', async () => {
    const { command, lines, purged } = commandUnderTest({ resolved: { path: undefined, hosts: ['example.com'] } });

    await command.run();

    expect(purged).toEqual([{ ...SCOPE, criterion: { hostnames: ['example.com'] } }]);
    expect(lines[0]).toBe('✔ Cache purge initiated for 1 domain.');
  });

  it('prints the same one line whatever the success body says', async () => {
    const empty = commandUnderTest({ purgeResult: {} });
    const other = commandUnderTest({ purgeResult: { message: 'something else' } });

    await empty.command.run();
    await other.command.run();

    expect(empty.lines).toEqual(other.lines);
    expect(empty.lines).toEqual(['✔ Cache purge initiated for /blog.']);
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
  ])('prints the same line when the environment %s', async (_label, environment) => {
    const { command, lines } = commandUnderTest({ resolved: { env: 'env1' }, environment });

    await command.run();

    expect(lines).toEqual(['✔ Cache purge initiated for /blog.']);
    expect(lines.join('')).not.toContain('undefined');
  });

  it('propagates a failed environment lookup without purging or printing anything', async () => {
    const failure = new Error('lookup exploded');
    const { command, lines, calls } = commandUnderTest({ getFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(calls).toEqual(['get']);
    expect(lines).toEqual([]);
  });

  it('reports an environment the lookup cannot find as a usage error naming its uid, and never purges', async () => {
    const uid = randomBytes(12).toString('hex');
    const { command, lines, calls } = commandUnderTest({
      resolved: { env: uid },
      getFails: new LaunchApiError(404, [{ code: 'launch.ENVIRONMENT.NOT_FOUND', message: 'Environment not found.' }]),
    });

    const error = await command.run().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(EXIT_USAGE);
    expect((error as UsageError).message).toBe(`No environment with UID "${uid}" found in this project.`);
    expect(calls).toEqual(['get']);
    expect(lines).toEqual([]);
  });

  it('rethrows any other failed environment lookup unchanged, without purging', async () => {
    const failure = new LaunchApiError(500, [{ code: 'launch.INTERNAL', message: 'boom' }]);
    const { command, calls } = commandUnderTest({ getFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(failure.exitCode).toBe(EXIT_RUNTIME);
    expect(failure.message).toBe('boom');
    expect(calls).toEqual(['get']);
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
