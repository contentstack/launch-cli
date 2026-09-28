import { CancelledError } from '../core/errors';
import { UxLike } from '../core/render';
import { ApiSurface } from '../resources';
import {
  askBranch,
  askChoice,
  askText,
  repositoryLabel,
} from './project.create.prompt';

const ORG = 'org1';
const GIT = { org: ORG, provider: 'GitHub', namespace: 'my-org' };

function deps(answers: unknown[], pages: Record<string, unknown> = {}) {
  const asked: unknown[] = [];
  const printed: string[] = [];
  const requested: unknown[] = [];
  let index = 0;

  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: async (payload: unknown) => {
      asked.push(payload);
      const answer = answers[index];
      index += 1;
      return answer as never;
    },
  };

  const api = {
    git: {
      repositories: async (params: unknown) => {
        requested.push(params);
        return pages.repositories;
      },
      branches: async (params: unknown) => {
        requested.push(params);
        return pages.branches;
      },
    },
  } as unknown as ApiSurface;

  return { deps: { api, ux }, asked, printed, requested, ux };
}

describe('project create prompts', () => {
  it('asks for free text and returns what was typed', async () => {
    const { asked, ux } = deps(['My Site']);

    await expect(askText(ux, 'Project name', 'suggested')).resolves.toBe('My Site');
    expect(asked).toEqual([{ type: 'input', name: 'value', message: 'Project name', default: 'suggested' }]);
  });

  it('cancels rather than accepting nothing at a text prompt', async () => {
    for (const answer of [undefined, null, '']) {
      const { ux } = deps([answer]);

      await expect(askText(ux, 'Project name')).rejects.toThrow(CancelledError);
    }
  });

  it('asks for a choice and returns the value picked', async () => {
    const { asked, ux } = deps(['FileUpload']);
    const choices = [
      { name: 'GitHub', value: 'GitHub' },
      { name: 'FileUpload', value: 'FileUpload' },
    ];

    await expect(askChoice(ux, 'Project type', choices, 'GitHub')).resolves.toBe('FileUpload');
    expect(asked[0]).toEqual({
      type: 'search-list',
      name: 'value',
      message: 'Project type',
      choices,
      default: 'GitHub',
    });
  });

  it('cancels rather than accepting nothing at a picker', async () => {
    const { ux } = deps([undefined]);

    await expect(askChoice(ux, 'Project type', [{ name: 'a', value: 'a' }])).rejects.toThrow(CancelledError);
  });

  it('labels a repository by its full name, falling back to its bare name', () => {
    expect(repositoryLabel({ fullName: 'my-org/my-repo', name: 'my-repo' })).toBe('my-org/my-repo');
    expect(repositoryLabel({ name: 'my-repo' })).toBe('my-repo');
    expect(repositoryLabel({})).toBe('');
  });

  it('offers the branches the API returned with the default branch pre-selected', async () => {
    const { deps: d, asked, requested } = deps(['develop'], {
      branches: { pagination: { count: 2, limit: 100 }, branches: [{ name: 'main' }, { name: 'develop' }] },
    });

    await expect(askBranch(d, { ...GIT, repoName: 'my-org/my-repo' }, 'main')).resolves.toBe('develop');
    expect(requested[0]).toEqual({ ...GIT, repoName: 'my-org/my-repo', limit: 100, skip: 0 });
    expect(asked[0]).toEqual({
      type: 'search-list',
      name: 'value',
      message: 'Choose a branch',
      choices: [
        { name: 'main', value: 'main' },
        { name: 'develop', value: 'develop' },
      ],
      default: 'main',
    });
  });

  it('refuses when the repository has no usable branch', async () => {
    const { deps: d } = deps([], { branches: { pagination: { count: 0, limit: 100 }, branches: [{ name: '' }] } });

    await expect(askBranch(d, { ...GIT, repoName: 'my-org/my-repo' })).rejects.toThrow(
      'No branches are available in "my-org/my-repo".',
    );
  });

  it('says how to reach a branch the first page did not show', async () => {
    const { deps: d, printed } = deps(['main'], {
      branches: { pagination: { count: 120, limit: 100 }, branches: [{ name: 'main' }] },
    });

    await askBranch(d, { ...GIT, repoName: 'my-org/my-repo' });

    expect(printed).toEqual(['Showing the first 1 of 120 branches. Use --branch to reach any of them.']);
  });
});
