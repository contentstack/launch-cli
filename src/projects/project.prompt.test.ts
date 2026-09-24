import { ApiSurface } from '../resources';
import { CLIENT_MAX_LIMIT, PICKER_PAGE_SIZE } from '../core/constants';
import { CancelledError, UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { UxLike } from '../core/render';
import { promptForProject } from './project.prompt';

type FakeProject = { uid?: string; name?: string };

function fakeDeps(
  pages: FakeProject[][],
  answer?: string,
  totalCount: number | null = pages.reduce((total, page) => total + page.length, 0),
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

  it('leaves out a project it could not act on and labels a nameless one by its uid', async () => {
    const { deps, inquired } = fakeDeps(
      [[{ name: 'no-uid' }, { uid: '', name: 'blank-uid' }, { uid: 'c'.repeat(24) }, { uid: 'a'.repeat(24), name: 'one' }]],
      'c'.repeat(24),
    );

    await expect(promptForProject(deps, 'org1')).resolves.toBe('c'.repeat(24));
    expect((inquired[0] as { choices: unknown }).choices).toEqual([
      { name: 'c'.repeat(24), value: 'c'.repeat(24) },
      { name: 'one', value: 'a'.repeat(24) },
    ]);
  });

  it('throws rather than prompting when no listed project carries a uid', async () => {
    const { deps, inquired } = fakeDeps([[{ name: 'no-uid' }]]);

    await expect(promptForProject(deps, 'org1')).rejects.toThrow('No projects found in this organization.');
    expect(inquired).toEqual([]);
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

  it.each([[undefined], [null], ['']])('treats %p back from the picker as the user cancelling', async (answer) => {
    const { deps, inquired } = fakeDeps([[{ uid: 'a'.repeat(24), name: 'one' }]], answer as string | undefined);

    await expect(promptForProject(deps, 'org1')).rejects.toThrow(CancelledError);
    await expect(promptForProject(deps, 'org1')).rejects.toThrow('Cancelled. Nothing was changed.');
    expect(inquired).toHaveLength(2);
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

  it('prompts without a truncation warning when the page reports no usable total', async () => {
    const { deps, inquired, printed } = fakeDeps([[{ uid: 'a'.repeat(24), name: 'site' }]], 'a'.repeat(24), null);

    await expect(promptForProject(deps, 'org1')).resolves.toBe('a'.repeat(24));
    expect(printed).toEqual([]);
    expect(inquired).toHaveLength(1);
  });

  it('asks the picker page for its own page size rather than the client limit guard', async () => {
    const { deps, listCalls } = fakeDeps([[{ uid: 'a'.repeat(24), name: 'site' }]], 'a'.repeat(24));

    await promptForProject(deps, 'org1');

    expect(listCalls).toEqual([{ org: 'org1', limit: PICKER_PAGE_SIZE, skip: 0 }]);
    expect(listCalls).not.toEqual([{ org: 'org1', limit: CLIENT_MAX_LIMIT, skip: 0 }]);
  });
});
