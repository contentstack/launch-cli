import { randomBytes } from 'node:crypto';

import { ApiSurface } from '../resources';
import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { UxLike } from '../core/render';
import { promptForProject, resolveProjectUid } from './project.prompt';

type FakeProject = { uid: string; name: string };

const PRIMARY_UID = randomBytes(12).toString('hex');
const SECOND_UID = randomBytes(12).toString('hex');
const HEX_NAME = randomBytes(12).toString('hex');

function fakeDeps(
  pages: FakeProject[][],
  answer?: string,
  totalCount: number = pages.reduce((total, page) => total + page.length, 0),
) {
  const inquired: unknown[] = [];
  const printed: string[] = [];
  const listCalls: unknown[] = [];
  const pageCalls: unknown[] = [];
  const fetchedPages: number[] = [];
  const pageAt = (index: number) => ({
    pagination: { count: totalCount, limit: 100, skip: null },
    projects: pages[index] ?? [],
  });
  const api = {
    projects: {
      list: async (params: unknown) => {
        listCalls.push(params);
        return pageAt(0);
      },
      pages: async function* (params: unknown) {
        pageCalls.push(params);
        for (let index = 0; index < pages.length; index += 1) {
          fetchedPages.push(index);
          yield pageAt(index);
        }
      },
    },
  } as unknown as ApiSurface;
  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload);
      return answer as never;
    },
  };
  return { deps: { api, ux }, inquired, printed, listCalls, pageCalls, fetchedPages };
}

function failingDeps(failure: Error) {
  const api = {
    projects: {
      list: async () => {
        throw failure;
      },
      pages: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(failure) }),
      }),
    },
  } as unknown as ApiSurface;
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api, ux };
}

describe('resolveProjectUid', () => {
  it('passes a 24-character hex uid straight through without calling the API', async () => {
    const { deps, pageCalls } = fakeDeps([]);

    await expect(resolveProjectUid(deps, 'org1', PRIMARY_UID)).resolves.toBe(
      PRIMARY_UID,
    );
    expect(pageCalls).toEqual([]);
  });

  it('looks a name up and returns its uid', async () => {
    const { deps, pageCalls, fetchedPages } = fakeDeps([[{ uid: PRIMARY_UID, name: 'marketing-site' }]]);

    await expect(resolveProjectUid(deps, 'org1', 'marketing-site')).resolves.toBe(PRIMARY_UID);
    expect(pageCalls).toEqual([{ org: 'org1' }]);
    expect(fetchedPages).toEqual([0]);
  });

  it('throws naming the value when no project matches anywhere in the organization', async () => {
    const { deps, pageCalls } = fakeDeps([[{ uid: PRIMARY_UID, name: 'marketing-site' }]]);

    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(UsageError);
    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(pageCalls).toEqual([{ org: 'org1' }, { org: 'org1' }]);
  });

  it('walks past the first page to find a project the org only holds further in', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      uid: index.toString().padStart(24, '0'),
      name: `project-${index}`,
    }));
    const secondPage = [{ uid: SECOND_UID, name: 'docs-site' }];
    const { deps, fetchedPages } = fakeDeps([firstPage, secondPage], undefined, 101);

    await expect(resolveProjectUid(deps, 'org1', 'docs-site')).resolves.toBe(SECOND_UID);
    expect(fetchedPages).toEqual([0, 1]);
  });

  it('exhausts every page before reporting a name the organization does not hold', async () => {
    const { deps, fetchedPages } = fakeDeps(
      [
        [{ uid: 'a'.repeat(24), name: 'one' }],
        [{ uid: 'b'.repeat(24), name: 'two' }],
        [{ uid: 'c'.repeat(24), name: 'three' }],
      ],
      undefined,
      3,
    );

    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(fetchedPages).toEqual([0, 1, 2]);
  });

  it('stops fetching pages as soon as the name matches rather than draining the organization', async () => {
    const { deps, fetchedPages } = fakeDeps(
      [
        [{ uid: 'a'.repeat(24), name: 'one' }],
        [{ uid: 'b'.repeat(24), name: 'two' }],
        [{ uid: 'c'.repeat(24), name: 'three' }],
      ],
      undefined,
      3,
    );

    await expect(resolveProjectUid(deps, 'org1', 'two')).resolves.toBe('b'.repeat(24));
    expect(fetchedPages).toEqual([0, 1]);
  });

  it('reports a not-found rather than looping when the organization yields no pages at all', async () => {
    const { deps, fetchedPages } = fakeDeps([], undefined, 150);

    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(UsageError);
    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(fetchedPages).toEqual([]);
  });

  it('passes an uppercase hex uid straight through without calling the API', async () => {
    const { deps, pageCalls } = fakeDeps([]);

    await expect(resolveProjectUid(deps, 'org1', PRIMARY_UID.toUpperCase())).resolves.toBe(
      PRIMARY_UID.toUpperCase(),
    );
    expect(pageCalls).toEqual([]);
  });

  it.each([['0'.repeat(23)], ['0'.repeat(25)]])('treats the %s-character hex string as a name, not a uid', async (value) => {
    const { deps, pageCalls } = fakeDeps([[{ uid: PRIMARY_UID, name: value }]]);

    await expect(resolveProjectUid(deps, 'org1', value)).resolves.toBe(PRIMARY_UID);
    expect(pageCalls).toEqual([{ org: 'org1' }]);
  });

  it('returns a 24-character hex project name unchanged rather than looking it up', async () => {
    const hexName = HEX_NAME;
    const { deps, pageCalls } = fakeDeps([[{ uid: PRIMARY_UID, name: hexName }]]);

    await expect(resolveProjectUid(deps, 'org1', hexName)).resolves.toBe(hexName);
    expect(pageCalls).toEqual([]);
  });

  it('matches a project name case-sensitively', async () => {
    const { deps } = fakeDeps([[{ uid: PRIMARY_UID, name: 'Marketing-Site' }]]);

    await expect(resolveProjectUid(deps, 'org1', 'Marketing-Site')).resolves.toBe(PRIMARY_UID);
    await expect(resolveProjectUid(deps, 'org1', 'marketing-site')).rejects.toThrow(
      'No project named "marketing-site" found in this organization.',
    );
  });

  it('propagates an api failure raised while paging the organization projects', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);

    await expect(resolveProjectUid(failingDeps(failure), 'org1', 'marketing-site')).rejects.toBe(failure);
  });
});

describe('promptForProject', () => {
  it('offers every project by name and returns the chosen uid', async () => {
    const { deps, inquired, printed } = fakeDeps(
      [
        [
          { uid: 'a'.repeat(24), name: 'one' },
          { uid: 'b'.repeat(24), name: 'two' },
        ],
      ],
      'b'.repeat(24),
    );

    await expect(promptForProject(deps, 'org1')).resolves.toBe('b'.repeat(24));
    expect(inquired[0]).toEqual({
      type: 'search-list',
      name: 'project',
      message: 'Choose a project',
      choices: [
        { name: 'one', value: 'a'.repeat(24) },
        { name: 'two', value: 'b'.repeat(24) },
      ],
    });
    expect(printed).toEqual([]);
  });

  it('fetches a single capped page rather than paging the whole organization into the picker', async () => {
    const { deps, listCalls, pageCalls, fetchedPages } = fakeDeps(
      [[{ uid: 'a'.repeat(24), name: 'one' }], [{ uid: 'b'.repeat(24), name: 'two' }]],
      'a'.repeat(24),
      2,
    );

    await expect(promptForProject(deps, 'org1')).resolves.toBe('a'.repeat(24));
    expect(listCalls).toEqual([{ org: 'org1', limit: 100, skip: 0 }]);
    expect(pageCalls).toEqual([]);
    expect(fetchedPages).toEqual([]);
  });

  it('throws when the organization has no projects instead of prompting with an empty list', async () => {
    const { deps, inquired, listCalls } = fakeDeps([]);

    await expect(promptForProject(deps, 'org1')).rejects.toThrow(UsageError);
    await expect(promptForProject(deps, 'org1')).rejects.toThrow('No projects found in this organization.');
    expect(inquired).toEqual([]);
    expect(listCalls).toEqual([
      { org: 'org1', limit: 100, skip: 0 },
      { org: 'org1', limit: 100, skip: 0 },
    ]);
  });

  it('returns nothing when the user picks no project, leaving the input unresolved', async () => {
    const { deps, inquired } = fakeDeps([[{ uid: 'a'.repeat(24), name: 'one' }]], undefined);

    await expect(promptForProject(deps, 'org1')).resolves.toBeUndefined();
    expect(inquired).toHaveLength(1);
  });

  it('propagates an api failure raised while listing the organization projects', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);

    await expect(promptForProject(failingDeps(failure), 'org1')).rejects.toBe(failure);
  });

  it('warns before prompting when the fetched page is a truncated view of the organization', async () => {
    const projects = Array.from({ length: 100 }, (_, index) => ({
      uid: index.toString().padStart(24, '0'),
      name: `project-${index}`,
    }));
    const { deps, inquired, printed } = fakeDeps([projects], projects[0].uid, 150);

    await expect(promptForProject(deps, 'org1')).resolves.toBe(projects[0].uid);
    expect(printed).toEqual([
      'Showing the first 100 of 150 projects; refine your search if the one you want is missing. ' +
        'Use --project <name> to reach any project in the organization.',
    ]);
    expect(inquired[0]).toEqual({
      type: 'search-list',
      name: 'project',
      message: 'Choose a project',
      choices: projects.map((project) => ({ name: project.name, value: project.uid })),
    });
  });
});
