import type { UxLike } from '../core/prompt';
import type { ApiSurface } from '../resources';
import { askBranch } from './git.prompt';

const GIT = { org: 'org1', provider: 'GitHub', namespace: 'my-org' };

function deps(answers: unknown[], branches?: unknown) {
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
      branches: async (params: unknown) => {
        requested.push(params);
        return branches;
      },
    },
  } as unknown as ApiSurface;

  return { deps: { api, ux }, asked, printed, requested };
}

describe('askBranch', () => {
  it('offers the branches the API returned with the default branch pre-selected', async () => {
    const { deps: d, asked, requested } = deps(['develop'], {
      pagination: { count: 2, limit: 100 },
      branches: [{ name: 'main' }, { name: 'develop' }],
    });

    await expect(askBranch(d, { ...GIT, repoName: 'my-org/my-repo' }, 'main')).resolves.toBe('develop');
    expect(requested[0]).toEqual({ ...GIT, repoName: 'my-org/my-repo', limit: 100, skip: 0 });
    expect(asked[0]).toEqual({
      type: 'list',
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
    const { deps: d } = deps([], { pagination: { count: 0, limit: 100 }, branches: [{ name: '' }] });

    await expect(askBranch(d, { ...GIT, repoName: 'my-org/my-repo' })).rejects.toThrow(
      'No branches are available in "my-org/my-repo".',
    );
  });

  it('says how to reach a branch the first page did not show', async () => {
    const { deps: d, printed } = deps(['main'], { pagination: { count: 120, limit: 100 }, branches: [{ name: 'main' }] });

    await askBranch(d, { ...GIT, repoName: 'my-org/my-repo' });

    expect(printed).toEqual(['Showing the first 1 of 120 branches. Use --branch to reach any of them.']);
  });
});
