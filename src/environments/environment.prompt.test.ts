import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ApiSurface } from '../resources';
import { promptForEnvironment } from './environment.prompt';

const SCOPE = { org: 'org1', project: 'proj1' };

function deps(answers: unknown[], page: unknown) {
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
    environments: {
      list: async (params: unknown) => {
        requested.push(params);
        return page;
      },
    },
  } as unknown as ApiSurface;

  return { deps: { api, ux }, asked, printed, requested };
}

describe('promptForEnvironment', () => {
  it('offers one page of the project environments as a list labelled by name and answers with the uid', async () => {
    const { deps: d, asked, printed, requested } = deps(['e2'], {
      pagination: { count: 2, limit: 100 },
      environments: [
        { uid: 'e1', name: 'staging' },
        { uid: 'e2', name: 'production' },
      ],
    });

    await expect(promptForEnvironment(d, SCOPE)).resolves.toBe('e2');
    expect(requested).toEqual([{ ...SCOPE, limit: 100, skip: 0 }]);
    expect(asked).toEqual([
      {
        type: 'list',
        name: 'value',
        message: 'Choose an environment',
        choices: [
          { name: 'staging', value: 'e1' },
          { name: 'production', value: 'e2' },
        ],
        default: undefined,
        loop: false,
        pageSize: 2,
      },
    ]);
    expect(printed).toEqual([]);
  });

  it.each([[undefined], [''], ['  ']])(
    'labels an environment whose name is %p by its uid',
    async (name) => {
      const { deps: d, asked } = deps(['e1'], { pagination: { count: 1, limit: 100 }, environments: [{ uid: 'e1', name }] });

      await promptForEnvironment(d, SCOPE);

      expect((asked[0] as { choices: unknown }).choices).toEqual([{ name: 'e1', value: 'e1' }]);
    },
  );

  it('leaves out an environment that carries no uid, since choosing it could address nothing', async () => {
    const { deps: d, asked } = deps(['e2'], {
      pagination: { count: 3, limit: 100 },
      environments: [{ name: 'orphan' }, { uid: '  ', name: 'blank' }, { uid: 'e2', name: 'production' }],
    });

    await promptForEnvironment(d, SCOPE);

    expect((asked[0] as { choices: unknown }).choices).toEqual([{ name: 'production', value: 'e2' }]);
  });

  it('refuses with a usage error, asking nothing, when the project has no choosable environment', async () => {
    const { deps: d, asked } = deps([], { pagination: { count: 1, limit: 100 }, environments: [{ name: 'orphan' }] });

    const failure = await promptForEnvironment(d, SCOPE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe('No environments found in this project.');
    expect(asked).toEqual([]);
  });

  it('says how to reach an environment the first page did not show', async () => {
    const { deps: d, printed } = deps(['e1'], {
      pagination: { count: 101, limit: 100 },
      environments: [{ uid: 'e1', name: 'production' }],
    });

    await promptForEnvironment(d, SCOPE);

    expect(printed).toEqual(['Showing the first 1 of 101 environments. Use --env to reach any of them.']);
  });

  it('cancels when the picker is dismissed without an answer', async () => {
    const { deps: d } = deps([undefined], { pagination: { count: 1, limit: 100 }, environments: [{ uid: 'e1', name: 'production' }] });

    await expect(promptForEnvironment(d, SCOPE)).rejects.toBeInstanceOf(CancelledError);
  });

  it('propagates a failed environment list', async () => {
    const failure = new Error('list failed');
    const api = { environments: { list: async () => Promise.reject(failure) } } as unknown as ApiSurface;

    await expect(promptForEnvironment({ api, ux: deps([], undefined).deps.ux }, SCOPE)).rejects.toBe(failure);
  });
});
