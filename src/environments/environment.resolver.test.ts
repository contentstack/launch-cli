import { randomBytes } from 'node:crypto';

import { EXIT_USAGE } from '../core/constants';
import { UsageError } from '../core/errors';
import { ResourceRef } from '../core/resource-ref';
import type { EnvironmentPages } from './environment.resolver';
import { EnvironmentResolver } from './environment.resolver';
import type { EnvironmentsPage } from './types';

interface FakeEnvironment {
  uid?: string | null;
  name?: string;
}

const SCOPE = { org: 'org1', project: 'proj1' };
const FIRST_UID = randomBytes(12).toString('hex');
const SECOND_UID = randomBytes(12).toString('hex');

function fakePages(pages: FakeEnvironment[][]) {
  const pageCalls: unknown[] = [];
  const fetchedPages: number[] = [];
  const environments: EnvironmentPages = {
    pages: async function* (params: unknown) {
      pageCalls.push(params);
      for (let index = 0; index < pages.length; index += 1) {
        fetchedPages.push(index);
        yield { pagination: { count: 0, limit: 100, skip: null }, environments: pages[index] } as EnvironmentsPage;
      }
    },
  };

  return { environments, pageCalls, fetchedPages };
}

describe('EnvironmentResolver', () => {
  it('returns a uid reference without calling the API at all', async () => {
    const { environments, pageCalls } = fakePages([]);

    await expect(new EnvironmentResolver(environments).toUid(SCOPE, ResourceRef.parse(FIRST_UID))).resolves.toBe(
      FIRST_UID,
    );
    expect(pageCalls).toEqual([]);
  });

  it('scans the project for the name and stops reading pages once it matches', async () => {
    const { environments, pageCalls, fetchedPages } = fakePages([
      [{ uid: FIRST_UID, name: 'staging' }],
      [{ uid: SECOND_UID, name: 'production' }],
      [{ uid: FIRST_UID, name: 'never-read' }],
    ]);

    await expect(
      new EnvironmentResolver(environments).toUid(SCOPE, { kind: 'name', name: 'production' }),
    ).resolves.toBe(SECOND_UID);
    expect(pageCalls).toEqual([SCOPE]);
    expect(fetchedPages).toEqual([0, 1]);
  });

  it('matches the name exactly and case-sensitively', async () => {
    const { environments } = fakePages([
      [
        { uid: FIRST_UID, name: 'Production' },
        { uid: FIRST_UID, name: ' production' },
        { uid: SECOND_UID, name: 'production' },
      ],
    ]);

    await expect(
      new EnvironmentResolver(environments).toUid(SCOPE, { kind: 'name', name: 'production' }),
    ).resolves.toBe(SECOND_UID);
  });

  it.each([[undefined], [null], [''], ['  ']])(
    'skips an environment of the wanted name whose uid is %p and resolves the next one that has one',
    async (uid) => {
      const { environments } = fakePages([[{ uid, name: 'production' }], [{ uid: SECOND_UID, name: 'production' }]]);

      await expect(
        new EnvironmentResolver(environments).toUid(SCOPE, { kind: 'name', name: 'production' }),
      ).resolves.toBe(SECOND_UID);
    },
  );

  it('refuses with a usage error naming the environment when no environment carries that name', async () => {
    const { environments } = fakePages([[{ uid: FIRST_UID, name: 'Production' }], [{ uid: null, name: 'production' }]]);

    const failure = await new EnvironmentResolver(environments)
      .toUid(SCOPE, { kind: 'name', name: 'production' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(EXIT_USAGE);
    expect((failure as Error).message).toBe('No environment named "production" found in this project.');
  });

  it('propagates a failed page rather than reporting no match', async () => {
    const failure = new Error('page failed');
    const environments: EnvironmentPages = {
      pages: () =>
        ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(failure) }),
        }) as unknown as AsyncGenerator<EnvironmentsPage>,
    };

    await expect(
      new EnvironmentResolver(environments).toUid(SCOPE, { kind: 'name', name: 'production' }),
    ).rejects.toBe(failure);
  });
});
