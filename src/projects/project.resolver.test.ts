import { randomBytes } from 'node:crypto';

import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { ProjectRef } from './project-ref';
import { ProjectPages, ProjectResolver } from './project.resolver';
import { ProjectsPage } from './types';

type FakeProject = { uid: string; name: string };

const PRIMARY_UID = randomBytes(12).toString('hex');
const SECOND_UID = randomBytes(12).toString('hex');
const HEX_NAME = randomBytes(12).toString('hex');

function fakePages(pages: FakeProject[][], totalCount = pages.reduce((total, page) => total + page.length, 0)) {
  const pageCalls: unknown[] = [];
  const fetchedPages: number[] = [];
  const projects: ProjectPages = {
    pages: async function* (params: unknown) {
      pageCalls.push(params);
      for (let index = 0; index < pages.length; index += 1) {
        fetchedPages.push(index);
        yield { pagination: { count: totalCount, limit: 100, skip: null }, projects: pages[index] } as ProjectsPage;
      }
    },
  };

  return { projects, pageCalls, fetchedPages };
}

function failingPages(failure: Error): ProjectPages {
  return {
    pages: () =>
      ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(failure) }) }) as unknown as AsyncGenerator<ProjectsPage>,
  };
}

describe('ProjectResolver', () => {
  it('returns a uid reference without calling the API at all', async () => {
    const { projects, pageCalls } = fakePages([]);

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse(PRIMARY_UID))).resolves.toBe(PRIMARY_UID);
    expect(pageCalls).toEqual([]);
  });

  it('returns an uppercase uid reference unchanged and without calling the API', async () => {
    const { projects, pageCalls } = fakePages([]);
    const upper = PRIMARY_UID.toUpperCase();

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse(upper))).resolves.toBe(upper);
    expect(pageCalls).toEqual([]);
  });

  it('looks a name up and returns its uid', async () => {
    const { projects, pageCalls, fetchedPages } = fakePages([[{ uid: PRIMARY_UID, name: 'marketing-site' }]]);

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse('marketing-site'))).resolves.toBe(
      PRIMARY_UID,
    );
    expect(pageCalls).toEqual([{ org: 'org1' }]);
    expect(fetchedPages).toEqual([0]);
  });

  it('throws naming the value when no project matches anywhere in the organization', async () => {
    const { projects, pageCalls } = fakePages([[{ uid: PRIMARY_UID, name: 'marketing-site' }]]);
    const resolver = new ProjectResolver(projects);

    await expect(resolver.toUid('org1', ProjectRef.parse('ghost'))).rejects.toThrow(UsageError);
    await expect(resolver.toUid('org1', ProjectRef.parse('ghost'))).rejects.toThrow(
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

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse('docs-site'))).resolves.toBe(SECOND_UID);
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

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse('ghost'))).rejects.toThrow(
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

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse('two'))).resolves.toBe('b'.repeat(24));
    expect(fetchedPages).toEqual([0, 1]);
  });

  it('reports a not-found rather than looping when the organization yields no pages at all', async () => {
    const { projects, fetchedPages } = fakePages([], 150);
    const resolver = new ProjectResolver(projects);

    await expect(resolver.toUid('org1', ProjectRef.parse('ghost'))).rejects.toThrow(UsageError);
    await expect(resolver.toUid('org1', ProjectRef.parse('ghost'))).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(fetchedPages).toEqual([]);
  });

  it.each([['0'.repeat(23)], ['0'.repeat(25)]])('looks the %s-character hex string up as a name', async (value) => {
    const { projects, pageCalls } = fakePages([[{ uid: PRIMARY_UID, name: value }]]);

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse(value))).resolves.toBe(PRIMARY_UID);
    expect(pageCalls).toEqual([{ org: 'org1' }]);
  });

  it('returns a 24-character hex project name unchanged rather than looking it up', async () => {
    const { projects, pageCalls } = fakePages([[{ uid: PRIMARY_UID, name: HEX_NAME }]]);

    await expect(new ProjectResolver(projects).toUid('org1', ProjectRef.parse(HEX_NAME))).resolves.toBe(HEX_NAME);
    expect(pageCalls).toEqual([]);
  });

  it('matches a project name case-sensitively', async () => {
    const { projects } = fakePages([[{ uid: PRIMARY_UID, name: 'Marketing-Site' }]]);
    const resolver = new ProjectResolver(projects);

    await expect(resolver.toUid('org1', ProjectRef.parse('Marketing-Site'))).resolves.toBe(PRIMARY_UID);
    await expect(resolver.toUid('org1', ProjectRef.parse('marketing-site'))).rejects.toThrow(
      'No project named "marketing-site" found in this organization.',
    );
  });

  it('propagates an api failure raised while paging the organization projects', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);

    await expect(
      new ProjectResolver(failingPages(failure)).toUid('org1', ProjectRef.parse('marketing-site')),
    ).rejects.toBe(failure);
  });
});
