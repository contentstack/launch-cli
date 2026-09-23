import { ApiSurface } from '../api';
import { UsageError } from '../errors';
import { UxLike } from '../output/render';
import { promptForProject, resolveProjectUid } from './project';

function fakeDeps(
  projects: { uid: string; name: string }[],
  answer?: string,
  totalCount: number = projects.length,
) {
  const inquired: unknown[] = [];
  const printed: string[] = [];
  const listCalls: unknown[] = [];
  const api = {
    projects: {
      list: async (params: unknown) => {
        listCalls.push(params);
        return { pagination: { count: totalCount, limit: 100, skip: 0 }, projects };
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
  return { deps: { api, ux }, inquired, printed, listCalls };
}

describe('resolveProjectUid', () => {
  it('passes a 24-character hex uid straight through without calling the API', async () => {
    const { deps, listCalls } = fakeDeps([]);

    await expect(resolveProjectUid(deps, 'org1', '507f1f77bcf86cd799439011')).resolves.toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(listCalls).toEqual([]);
  });

  it('looks a name up and returns its uid', async () => {
    const { deps, listCalls } = fakeDeps([{ uid: '507f1f77bcf86cd799439011', name: 'marketing-site' }]);

    await expect(resolveProjectUid(deps, 'org1', 'marketing-site')).resolves.toBe('507f1f77bcf86cd799439011');
    expect(listCalls).toEqual([{ org: 'org1', limit: 100, skip: 0 }]);
  });

  it('throws naming the value when no project matches and the full org was fetched', async () => {
    const { deps, listCalls } = fakeDeps([{ uid: '507f1f77bcf86cd799439011', name: 'marketing-site' }]);

    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(UsageError);
    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(
      'No project named "ghost" found in this organization.',
    );
    expect(listCalls).toEqual([
      { org: 'org1', limit: 100, skip: 0 },
      { org: 'org1', limit: 100, skip: 0 },
    ]);
  });

  it('throws a truncation-aware message when the org has more projects than the fetched page and none match', async () => {
    const projects = Array.from({ length: 100 }, (_, index) => ({
      uid: index.toString().padStart(24, '0'),
      name: `project-${index}`,
    }));
    const { deps, listCalls } = fakeDeps(projects, undefined, 150);

    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(UsageError);
    await expect(resolveProjectUid(deps, 'org1', 'ghost')).rejects.toThrow(
      'Could not find a project named "ghost" among the first 100 of 150 projects in this organization; pass the project UID instead.',
    );
    expect(listCalls).toEqual([
      { org: 'org1', limit: 100, skip: 0 },
      { org: 'org1', limit: 100, skip: 0 },
    ]);
  });

  it('finds a match on the fetched page even when the org has more projects beyond it', async () => {
    const projects = [
      { uid: '507f1f77bcf86cd799439011', name: 'marketing-site' },
      { uid: '607f1f77bcf86cd799439022', name: 'docs-site' },
    ];
    const { deps, listCalls } = fakeDeps(projects, undefined, 150);

    await expect(resolveProjectUid(deps, 'org1', 'docs-site')).resolves.toBe('607f1f77bcf86cd799439022');
    expect(listCalls).toEqual([{ org: 'org1', limit: 100, skip: 0 }]);
  });
});

describe('promptForProject', () => {
  it('offers every project by name and returns the chosen uid', async () => {
    const { deps, inquired, printed } = fakeDeps(
      [
        { uid: 'a'.repeat(24), name: 'one' },
        { uid: 'b'.repeat(24), name: 'two' },
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

  it('warns before prompting when the fetched page is a truncated view of the organization', async () => {
    const projects = Array.from({ length: 100 }, (_, index) => ({
      uid: index.toString().padStart(24, '0'),
      name: `project-${index}`,
    }));
    const { deps, inquired, printed } = fakeDeps(projects, projects[0].uid, 150);

    await expect(promptForProject(deps, 'org1')).resolves.toBe(projects[0].uid);
    expect(printed).toEqual([
      'Showing the first 100 of 150 projects; refine your search if the one you want is missing.',
    ]);
    expect(inquired[0]).toEqual({
      type: 'search-list',
      name: 'project',
      message: 'Choose a project',
      choices: projects.map((project) => ({ name: project.name, value: project.uid })),
    });
  });
});
