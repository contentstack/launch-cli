import { CancelledError, UsageError } from '../core/errors';
import { UxLike } from '../core/render';
import { ApiSurface } from '../resources';
import {
  askBranch,
  askChoice,
  askNamespace,
  askRepository,
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
      namespaces: async (params: unknown) => {
        requested.push(params);
        return pages.namespaces;
      },
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

  it('offers the namespaces the API returned and asks for a full page of them', async () => {
    const { deps: d, asked, requested } = deps(['my-org'], {
      namespaces: { pagination: { count: 2, limit: 100 }, namespaces: [{ name: 'my-org' }, { name: 'other-org' }] },
    });

    await expect(askNamespace(d, ORG)).resolves.toBe('my-org');
    expect(requested[0]).toEqual({ org: ORG, limit: 100, skip: 0 });
    expect((asked[0] as { choices: unknown }).choices).toEqual([
      { name: 'my-org', value: 'my-org' },
      { name: 'other-org', value: 'other-org' },
    ]);
  });

  it('offers only GitHub namespaces, leaving out those of an external Git provider the create flow cannot use', async () => {
    const { deps: d, asked, printed } = deps(['my-org'], {
      namespaces: {
        pagination: { count: 3, limit: 100 },
        namespaces: [
          { name: 'my-org', provider: 'GitHub' },
          { name: 'gitlab-group', provider: 'ExternalGitProvider' },
          { name: 'legacy-org' },
        ],
      },
    });

    await askNamespace(d, ORG);

    expect((asked[0] as { choices: unknown }).choices).toEqual([
      { name: 'my-org', value: 'my-org' },
      { name: 'legacy-org', value: 'legacy-org' },
    ]);
    expect(printed).toEqual([]);
  });

  it('says there is no GitHub namespace when the organization has only external ones', async () => {
    const { deps: d } = deps(['x'], {
      namespaces: { pagination: { count: 1, limit: 100 }, namespaces: [{ name: 'gitlab-group', provider: 'ExternalGitProvider' }] },
    });

    await expect(askNamespace(d, ORG)).rejects.toThrow(
      'No GitHub namespaces are connected to this organization. Connect GitHub in the Launch app first.',
    );
  });

  it('says how to reach a namespace the first page did not show', async () => {
    const { deps: d, printed } = deps(['my-org'], {
      namespaces: { pagination: { count: 250, limit: 100 }, namespaces: [{ name: 'my-org' }] },
    });

    await askNamespace(d, ORG);

    expect(printed).toEqual(['Showing the first 1 of 250 namespaces. Use --namespace to reach any of them.']);
  });

  it('says nothing about truncation when the page reports no usable count', async () => {
    for (const pagination of [{ limit: 100 }, { count: '250', limit: 100 }]) {
      const { deps: d, printed } = deps(['my-org'], { namespaces: { pagination, namespaces: [{ name: 'my-org' }] } });

      await expect(askNamespace(d, ORG)).resolves.toBe('my-org');

      expect(printed).toEqual([]);
    }
  });

  it('says nothing about truncation when the page held everything', async () => {
    const { deps: d, printed } = deps(['my-org'], {
      namespaces: { pagination: { count: 1, limit: 100 }, namespaces: [{ name: 'my-org' }] },
    });

    await askNamespace(d, ORG);

    expect(printed).toEqual([]);
  });

  it('refuses when the organization has no usable namespace to pick', async () => {
    for (const namespaces of [[], [{ type: 'Organization' }], [{ name: '' }]]) {
      const { deps: d } = deps([], { namespaces: { pagination: { count: 0, limit: 100 }, namespaces } });

      await expect(askNamespace(d, ORG)).rejects.toThrow(UsageError);
      await expect(askNamespace(d, ORG)).rejects.toThrow('No Git namespaces are available for this organization.');
    }
  });

  it('returns the whole repository record for the label that was picked', async () => {
    const repository = { fullName: 'my-org/my-repo', url: 'https://github.com/my-org/my-repo', defaultBranch: 'main' };
    const { deps: d, requested } = deps(['my-org/my-repo'], {
      repositories: { pagination: { count: 1, limit: 100 }, repositories: [repository] },
    });

    await expect(askRepository(d, GIT)).resolves.toBe(repository);
    expect(requested[0]).toEqual({ ...GIT, limit: 100, skip: 0 });
  });

  it('accepts the bare repository name typed at the picker, not only the label it shows', async () => {
    const other = { fullName: 'my-org/other', name: 'other' };
    const repository = { fullName: 'my-org/my-repo', name: 'my-repo' };
    const { deps: d, asked } = deps(['my-repo'], {
      repositories: { pagination: { count: 2, limit: 100 }, repositories: [other, repository] },
    });

    await expect(askRepository(d, GIT)).resolves.toBe(repository);
    expect(asked).toHaveLength(1);
  });

  it('refuses a repository typed at the picker that matches nothing it offered', async () => {
    const { deps: d, asked } = deps(['my-rep', 'my-rep'], {
      repositories: { pagination: { count: 1, limit: 100 }, repositories: [{ fullName: 'my-org/my-repo', name: 'my-repo' }] },
    });

    await expect(askRepository(d, GIT)).rejects.toThrow(UsageError);
    await expect(askRepository(d, GIT)).rejects.toThrow(
      'No repository named "my-rep" was found under "my-org". Choose one from the list, or pass --repo.',
    );
    expect(asked).toHaveLength(2);
  });

  it('labels a repository by its full name, falling back to its bare name', () => {
    expect(repositoryLabel({ fullName: 'my-org/my-repo', name: 'my-repo' })).toBe('my-org/my-repo');
    expect(repositoryLabel({ name: 'my-repo' })).toBe('my-repo');
    expect(repositoryLabel({})).toBe('');
  });

  it('refuses when the namespace holds no usable repository', async () => {
    const { deps: d } = deps([], { repositories: { pagination: { count: 0, limit: 100 }, repositories: [{}] } });

    await expect(askRepository(d, GIT)).rejects.toThrow('No repositories are available under "my-org".');
  });

  it('says how to reach a repository the first page did not show', async () => {
    const { deps: d, printed } = deps(['my-org/my-repo'], {
      repositories: { pagination: { count: 400, limit: 100 }, repositories: [{ fullName: 'my-org/my-repo' }] },
    });

    await askRepository(d, GIT);

    expect(printed).toEqual(['Showing the first 1 of 400 repositories. Use --repo to reach any of them.']);
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
