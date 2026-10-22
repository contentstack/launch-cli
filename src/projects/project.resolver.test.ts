import { randomBytes } from 'node:crypto';

import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { ResourceRef } from '../core/resource-ref';
import type { ProjectPages } from './project.resolver';
import { ProjectResolver } from './project.resolver';
import type { ProjectsPage } from './types';

interface FakeProject { uid?: string | null; name?: string }

const PRIMARY_UID = randomBytes(12).toString('hex');
const SECOND_UID = randomBytes(12).toString('hex');
const HEX_NAME = randomBytes(12).toString('hex');

function fakePages(
  pages: FakeProject[][],
  totalCount = pages.reduce((total, page) => total + page.length, 0),
  owningOrg = 'org1',
) {
  const pageCalls: unknown[] = [];
  const fetchedPages: number[] = [];
  const getCalls: unknown[] = [];
  const projects: ProjectPages = {
    pages: async function* (params: unknown) {
      pageCalls.push(params);
      for (let index = 0; index < pages.length; index += 1) {
        fetchedPages.push(index);
        yield { pagination: { count: totalCount, limit: 100, skip: null }, projects: pages[index] } as ProjectsPage;
      }
    },
    get: async (params) => {
      getCalls.push(params);
      return { uid: params.project, organizationUid: owningOrg };
    },
  };

  return { projects, pageCalls, fetchedPages, getCalls };
}

function projectIn(organizationUid: string): ProjectPages {
  return fakePages([], 0, organizationUid).projects;
}

function failingPages(failure: Error): ProjectPages {
  return {
    pages: () =>
      ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(failure) }) }) as unknown as AsyncGenerator<ProjectsPage>,
    get: () => Promise.reject(failure),
  };
}

describe('ProjectResolver', () => {
  it('skips a project of the wanted name that carries no uid and resolves the next one that does', async () => {
    const { projects } = fakePages([[{ name: 'shared' }, { uid: '  ', name: 'shared' }], [{ uid: SECOND_UID, name: 'shared' }]]);

    await expect(new ProjectResolver(projects).toUid('org1', { kind: 'name', name: 'shared' })).resolves.toBe(SECOND_UID);
  });

  it('reports no match rather than resolving to nothing when the only project of that name has no uid', async () => {
    const { projects } = fakePages([[{ uid: null, name: 'shared' }]]);

    await expect(new ProjectResolver(projects).toUid('org1', { kind: 'name', name: 'shared' })).rejects.toThrow(
      'No project named "shared" found in this organization.',
    );
  });

  it('rejects a uid reference whose project belongs to another organization without naming the owner', async () => {
    const projects = projectIn('org-owner');

    await expect(new ProjectResolver(projects).toUid('org-other', ResourceRef.parse(PRIMARY_UID))).rejects.toThrow(
      new UsageError(`No project with UID "${PRIMARY_UID}" found in this organization.`),
    );
  });

  it('returns a uid reference once the project is confirmed to belong to the organization, without paging', async () => {
    const { projects, pageCalls, getCalls } = fakePages([]);

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse(PRIMARY_UID))).resolves.toBe(PRIMARY_UID);
    expect(getCalls).toEqual([{ org: 'org1', project: PRIMARY_UID }]);
    expect(pageCalls).toEqual([]);
  });

  it('returns an uppercase uid reference unchanged and without paging', async () => {
    const { projects, pageCalls } = fakePages([]);
    const upper = PRIMARY_UID.toUpperCase();

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse(upper))).resolves.toBe(upper);
    expect(pageCalls).toEqual([]);
  });

  it('looks a name up and returns its uid', async () => {
    const { projects, pageCalls, fetchedPages } = fakePages([[{ uid: PRIMARY_UID, name: 'marketing-site' }]]);

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse('marketing-site'))).resolves.toBe(
      PRIMARY_UID,
    );
    expect(pageCalls).toEqual([{ org: 'org1' }]);
    expect(fetchedPages).toEqual([0]);
  });

  it('throws naming the value when no project matches anywhere in the organization', async () => {
    const { projects, pageCalls } = fakePages([[{ uid: PRIMARY_UID, name: 'marketing-site' }]]);
    const resolver = new ProjectResolver(projects);

    await expect(resolver.toUid('org1', ResourceRef.parse('ghost'))).rejects.toThrow(UsageError);
    await expect(resolver.toUid('org1', ResourceRef.parse('ghost'))).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(pageCalls).toEqual([{ org: 'org1' }, { org: 'org1' }]);
  });

  it('walks past the first page to find a project the org only holds further in', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      uid: index.toString().padStart(24, '0'),
      name: `project-${index}`,
    }));
    const { projects, fetchedPages } = fakePages([firstPage, [{ uid: SECOND_UID, name: 'docs-site' }]], 101);

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse('docs-site'))).resolves.toBe(SECOND_UID);
    expect(fetchedPages).toEqual([0, 1]);
  });

  it('exhausts every page before reporting a name the organization does not hold', async () => {
    const { projects, fetchedPages } = fakePages(
      [
        [{ uid: 'a'.repeat(24), name: 'one' }],
        [{ uid: 'b'.repeat(24), name: 'two' }],
        [{ uid: 'c'.repeat(24), name: 'three' }],
      ],
      3,
    );

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse('ghost'))).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(fetchedPages).toEqual([0, 1, 2]);
  });

  it('stops fetching pages as soon as the name matches rather than draining the organization', async () => {
    const { projects, fetchedPages } = fakePages(
      [
        [{ uid: 'a'.repeat(24), name: 'one' }],
        [{ uid: 'b'.repeat(24), name: 'two' }],
        [{ uid: 'c'.repeat(24), name: 'three' }],
      ],
      3,
    );

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse('two'))).resolves.toBe('b'.repeat(24));
    expect(fetchedPages).toEqual([0, 1]);
  });

  it('reports a not-found rather than looping when the organization yields no pages at all', async () => {
    const { projects, fetchedPages } = fakePages([], 150);
    const resolver = new ProjectResolver(projects);

    await expect(resolver.toUid('org1', ResourceRef.parse('ghost'))).rejects.toThrow(UsageError);
    await expect(resolver.toUid('org1', ResourceRef.parse('ghost'))).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(fetchedPages).toEqual([]);
  });

  it.each([['0'.repeat(23)], ['0'.repeat(25)]])('looks the %s-character hex string up as a name', async (value) => {
    const { projects, pageCalls } = fakePages([[{ uid: PRIMARY_UID, name: value }]]);

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse(value))).resolves.toBe(PRIMARY_UID);
    expect(pageCalls).toEqual([{ org: 'org1' }]);
  });

  it('returns a 24-character hex project name unchanged rather than looking it up', async () => {
    const { projects, pageCalls } = fakePages([[{ uid: PRIMARY_UID, name: HEX_NAME }]]);

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse(HEX_NAME))).resolves.toBe(HEX_NAME);
    expect(pageCalls).toEqual([]);
  });

  it('matches a project name case-sensitively', async () => {
    const { projects } = fakePages([[{ uid: PRIMARY_UID, name: 'Marketing-Site' }]]);
    const resolver = new ProjectResolver(projects);

    await expect(resolver.toUid('org1', ResourceRef.parse('Marketing-Site'))).resolves.toBe(PRIMARY_UID);
    await expect(resolver.toUid('org1', ResourceRef.parse('marketing-site'))).rejects.toThrow(
      'No project named "marketing-site" found in this organization.',
    );
  });

  it('propagates an api failure raised while fetching a project by uid', async () => {
    const failure = new LaunchApiError(404, [{ code: 'launch.PROJECTS.NOT_FOUND' }]);

    await expect(new ProjectResolver(failingPages(failure)).toUid('org1', ResourceRef.parse(PRIMARY_UID))).rejects.toBe(
      failure,
    );
  });

  it('accepts a uid reference when the API does not report the project organization', async () => {
    const projects = { ...fakePages([]).projects, get: async () => ({ uid: PRIMARY_UID }) };

    await expect(new ProjectResolver(projects).toUid('org1', ResourceRef.parse(PRIMARY_UID))).resolves.toBe(PRIMARY_UID);
  });

  it('propagates an api failure raised while paging the organization projects', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);

    await expect(
      new ProjectResolver(failingPages(failure)).toUid('org1', ResourceRef.parse('marketing-site')),
    ).rejects.toBe(failure);
  });
});
