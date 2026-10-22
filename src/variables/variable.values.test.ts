import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { completeValues } from './variable.values';

function fakes(answers: string[] = [], stdin = '') {
  const prompts: { message: string; type: string }[] = [];
  const stdinReads: number[] = [];
  const queue = [...answers];
  const ux: UxLike = {
    print: () => undefined,
    inquire: (async (payload: { message: string; type: string }) => {
      prompts.push({ message: payload.message, type: payload.type });
      return queue.shift();
    }) as UxLike['inquire'],
  };

  return {
    prompts,
    stdinReads,
    deps: (isTTY: boolean) => ({
      services: { isTTY, ux } as unknown as ServiceContext,
      readStdin: async () => {
        stdinReads.push(1);
        return stdin;
      },
    }),
  };
}

describe('variable values', () => {
  it('passes every assignment that already has a value through without prompting or reading stdin', async () => {
    const { deps, prompts, stdinReads } = fakes();

    const completed = await completeValues([{ key: 'A', value: '1' }, { key: 'B', value: 'x y' }], deps(true));

    expect(completed).toEqual([{ key: 'A', value: '1' }, { key: 'B', value: 'x y' }]);
    expect(prompts).toEqual([]);
    expect(stdinReads).toEqual([]);
  });

  it('asks one hidden prompt for a lone bare key on a terminal, with no counter', async () => {
    const { deps, prompts } = fakes(['s3cret']);

    const completed = await completeValues([{ key: 'API_KEY', value: undefined }], deps(true));

    expect(completed).toEqual([{ key: 'API_KEY', value: 's3cret' }]);
    expect(prompts).toEqual([{ message: 'Value for API_KEY', type: 'password' }]);
  });

  it('asks in the order the keys were given with an n/m counter when there are several, skipping those with values', async () => {
    const { deps, prompts } = fakes(['one', 'two']);

    const completed = await completeValues(
      [{ key: 'A', value: undefined }, { key: 'B', value: 'given' }, { key: 'C', value: undefined }],
      deps(true),
    );

    expect(completed).toEqual([
      { key: 'A', value: 'one' },
      { key: 'B', value: 'given' },
      { key: 'C', value: 'two' },
    ]);
    expect(prompts.map((prompt) => prompt.message)).toEqual(['Value for A (1/2)', 'Value for C (2/2)']);
  });

  it.each([['  tok \n', '  tok '], ['tok\r\n', 'tok'], ['tok', 'tok']])(
    'keeps the whitespace of a piped value apart from its final line break (%p)',
    async (piped, expected) => {
      const { deps } = fakes([], piped);

      expect(await completeValues([{ key: 'API_KEY', value: undefined }], deps(false))).toEqual([
        { key: 'API_KEY', value: expected },
      ]);
    },
  );

  it('reads a lone bare key from stdin without a terminal and drops only the trailing newline', async () => {
    const { deps, prompts, stdinReads } = fakes([], 'piped-value\n');

    const completed = await completeValues([{ key: 'API_KEY', value: undefined }], deps(false));

    expect(completed).toEqual([{ key: 'API_KEY', value: 'piped-value' }]);
    expect(stdinReads).toHaveLength(1);
    expect(prompts).toEqual([]);
  });

  it('exits as a usage error naming --dotenv - for two bare keys without a terminal, reading nothing', async () => {
    const { deps, prompts, stdinReads } = fakes([], 'ignored');
    const bare = [{ key: 'A', value: undefined }, { key: 'B', value: undefined }];

    await expect(completeValues(bare, deps(false))).rejects.toThrow(UsageError);
    await expect(completeValues(bare, deps(false))).rejects.toThrow('--dotenv -');
    expect(stdinReads).toEqual([]);
    expect(prompts).toEqual([]);
  });

  it.each([[''], ['\n'], ['   \n']])('refuses an empty stdin value and names the key (%p)', async (stdin) => {
    const { deps } = fakes([], stdin);

    await expect(completeValues([{ key: 'API_KEY', value: undefined }], deps(false))).rejects.toThrow(UsageError);
    await expect(completeValues([{ key: 'API_KEY', value: undefined }], deps(false))).rejects.toThrow(
      'No value for API_KEY was piped in.',
    );
  });

  it('propagates a cancelled prompt and a failed stdin read', async () => {
    const { deps } = fakes([undefined as unknown as string]);

    await expect(completeValues([{ key: 'A', value: undefined }], deps(true))).rejects.toThrow(CancelledError);

    const failure = new Error('stdin closed');

    await expect(
      completeValues([{ key: 'A', value: undefined }], {
        services: fakes().deps(false).services,
        readStdin: async () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
  });

  it('never puts a typed value in an error or a prompt message', async () => {
    const { deps, prompts } = fakes(['never-printed-value']);

    await completeValues([{ key: 'A', value: undefined }], deps(true));

    expect(JSON.stringify(prompts)).not.toContain('never-printed-value');
  });
});
