import { EXIT_RUNTIME, MAX_PAGES } from '../core/constants';
import type { CmaCollection, CmaSession } from '../transport/cma-client';
import { OrganizationLookupError } from './organization.errors';
import { ORGANIZATION_PAGE_SIZE, OrganizationsApi } from './organizations.api';

function organizations(count: number, offset = 0): { uid: string; name: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    uid: `org${offset + index}`,
    name: `Org ${offset + index}`,
  }));
}

function pagedSession(pages: CmaCollection[], scoped?: string) {
  const queries: Record<string, unknown>[] = [];
  const fetched: string[] = [];

  const session: CmaSession = {
    fetchOrganizations: async (query) => {
      queries.push(query);
      return pages[Math.min(queries.length - 1, pages.length - 1)];
    },
    fetchOrganization: async (uid) => {
      fetched.push(uid);
      return { uid, name: 'Scoped Org' };
    },
    scopedOrganizationUid: () => scoped,
  };

  return { api: new OrganizationsApi(session), queries, fetched };
}

function failingSession(error: unknown, scoped?: string): OrganizationsApi {
  return new OrganizationsApi({
    fetchOrganizations: async () => {
      throw error;
    },
    fetchOrganization: async () => {
      throw error;
    },
    scopedOrganizationUid: () => scoped,
  });
}

function query(skip: number): Record<string, unknown> {
  return { limit: ORGANIZATION_PAGE_SIZE, asc: 'name', include_count: true, skip };
}

describe('OrganizationsApi.available', () => {
  it('lists every organization sorted by name, one page when the first page holds them all', async () => {
    const { api, queries, fetched } = pagedSession([{ items: organizations(2), count: 2 }]);

    await expect(api.available()).resolves.toEqual({
      organizations: [
        { uid: 'org0', name: 'Org 0' },
        { uid: 'org1', name: 'Org 1' },
      ],
      scoped: false,
    });
    expect(queries).toEqual([query(0)]);
    expect(fetched).toEqual([]);
  });

  it('pages on until the count is reached, advancing skip by the page size', async () => {
    const { api, queries } = pagedSession([
      { items: organizations(100), count: 250 },
      { items: organizations(100, 100), count: 250 },
      { items: organizations(50, 200), count: 250 },
    ]);

    const { organizations: listed } = await api.available();

    expect(listed).toHaveLength(250);
    expect(listed[249]).toEqual({ uid: 'org249', name: 'Org 249' });
    expect(queries).toEqual([query(0), query(100), query(200)]);
  });

  it('stops after a full page that reaches the count exactly, without asking for an empty one', async () => {
    const { api, queries } = pagedSession([
      { items: organizations(100), count: 100 },
      { items: organizations(1, 100), count: 100 },
    ]);

    const { organizations: listed } = await api.available();

    expect(listed).toHaveLength(100);
    expect(queries).toEqual([query(0)]);
  });

  it('asks for the next page when a full page falls one short of the count', async () => {
    const { api, queries } = pagedSession([
      { items: organizations(100), count: 101 },
      { items: organizations(1, 100), count: 101 },
    ]);

    const { organizations: listed } = await api.available();

    expect(listed).toHaveLength(101);
    expect(queries).toEqual([query(0), query(100)]);
  });

  it('stops on an empty page even when the count claims there are more', async () => {
    const { api, queries } = pagedSession([
      { items: organizations(100), count: 500 },
      { items: [], count: 500 },
    ]);

    const { organizations: listed } = await api.available();

    expect(listed).toHaveLength(100);
    expect(queries).toEqual([query(0), query(100)]);
  });

  it('stops on a short page when the response carries no count', async () => {
    const { api, queries } = pagedSession([{ items: organizations(100) }, { items: organizations(99, 100) }]);

    const { organizations: listed } = await api.available();

    expect(listed).toHaveLength(199);
    expect(queries).toEqual([query(0), query(100)]);
  });

  it('treats a response with no items as an empty page', async () => {
    const { api, queries } = pagedSession([{ count: 3 }]);

    await expect(api.available()).resolves.toEqual({ organizations: [], scoped: false });
    expect(queries).toEqual([query(0)]);
  });

  it('refuses rather than looping forever when every page is full and no count ends it', async () => {
    const { api, queries } = pagedSession([{ items: organizations(100) }]);

    const failure = await api.available().catch((error: Error) => error);

    expect(failure).toBeInstanceOf(OrganizationLookupError);
    expect((failure as OrganizationLookupError).exitCode).toBe(EXIT_RUNTIME);
    expect((failure as Error).message).toBe(
      `Could not list your organizations: stopped after ${MAX_PAGES * ORGANIZATION_PAGE_SIZE} organizations ` +
        'without reaching the end of the list. Pass --org with an organization UID.',
    );
    expect(queries).toHaveLength(MAX_PAGES);
    expect(queries[MAX_PAGES - 1]).toEqual(query((MAX_PAGES - 1) * ORGANIZATION_PAGE_SIZE));
  });

  it('drops an item with no usable uid and leaves a missing or blank name undefined', async () => {
    const { api } = pagedSession([
      {
        items: [null, 'org', { name: 'No Uid' }, { uid: '', name: 'Blank' }, { uid: 'org1' }, { uid: 'org2', name: ' ' }],
        count: 6,
      },
    ]);

    await expect(api.available()).resolves.toEqual({
      organizations: [
        { uid: 'org1', name: undefined },
        { uid: 'org2', name: undefined },
      ],
      scoped: false,
    });
  });

  it('fetches only the organization an OAuth session is scoped to, and lists nothing', async () => {
    const { api, queries, fetched } = pagedSession([{ items: organizations(2), count: 2 }], 'org7');

    await expect(api.available()).resolves.toEqual({
      organizations: [{ uid: 'org7', name: 'Scoped Org' }],
      scoped: true,
    });
    expect(fetched).toEqual(['org7']);
    expect(queries).toEqual([]);
  });

  it('keeps the scoped uid when the fetched organization carries no usable name', async () => {
    for (const found of [undefined, 'org7', { uid: 'org7' }]) {
      const api = new OrganizationsApi({
        fetchOrganizations: async () => ({}),
        fetchOrganization: async () => found,
        scopedOrganizationUid: () => 'org7',
      });

      await expect(api.available()).resolves.toEqual({ organizations: [{ uid: 'org7', name: undefined }], scoped: true });
    }
  });

  it.each([
    [{ errorMessage: 'You are not permitted', message: 'Request failed' }, 'You are not permitted.'],
    [{ errorMessage: '', message: 'Request failed with status code 500.' }, 'Request failed with status code 500.'],
    [new Error('socket hang up'), 'socket hang up.'],
    [{ status: 500 }, 'the Contentstack Management API gave no reason.'],
    [undefined, 'the Contentstack Management API gave no reason.'],
    ['plain text failure', 'plain text failure.'],
  ])('wraps a listing failure %p in its own wording with exit 1', async (error, reason) => {
    const failure = await failingSession(error)
      .available()
      .catch((caught: Error) => caught);

    expect(failure).toBeInstanceOf(OrganizationLookupError);
    expect((failure as OrganizationLookupError).exitCode).toBe(EXIT_RUNTIME);
    expect((failure as Error).message).toBe(
      `Could not list your organizations: ${reason} Pass --org with an organization UID.`,
    );
  });

  it('wraps a failure to fetch the scoped organization the same way', async () => {
    const failure = await failingSession(new Error('token expired'), 'org7')
      .available()
      .catch((caught: Error) => caught);

    expect(failure).toBeInstanceOf(OrganizationLookupError);
    expect((failure as Error).message).toBe(
      'Could not list your organizations: token expired. Pass --org with an organization UID.',
    );
  });
});
