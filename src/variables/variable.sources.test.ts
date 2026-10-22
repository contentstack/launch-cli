import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentVariableInput } from '../environments/types';
import { collectVariables } from './variable.sources';

function fakes(
  options: {
    files?: Record<string, string>;
    stdin?: string;
    answers?: string[];
    isTTY?: boolean;
    stack?: EnvironmentVariableInput[] | Error;
  } = {},
) {
  const files = options.files ?? {};
  const printed: string[] = [];
  const prompts: string[] = [];
  const reads: string[] = [];
  const events: string[] = [];
  const stackAsked: (string | undefined)[] = [];
  const stdinReads: number[] = [];
  const answers = [...(options.answers ?? [])];
  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: (async (payload: { message: string }) => {
      prompts.push(payload.message);
      return answers.shift();
    }) as UxLike['inquire'],
  };

  return {
    printed,
    prompts,
    reads,
    events,
    stackAsked,
    stdinReads,
    context: {
      services: { isTTY: options.isTTY ?? false, ux } as unknown as ServiceContext,
      dataDir: '/work',
      stack: async (alias?: string) => {
        events.push('stack');
        stackAsked.push(alias);

        if (options.stack instanceof Error) {
          throw options.stack;
        }

        return options.stack ?? [];
      },
      readFile: async (path: string) => {
        reads.push(path);
        events.push(`read:${path}`);

        if (!(path in files)) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }

        return files[path];
      },
      exists: (path: string) => path in files,
      readStdin: async () => {
        stdinReads.push(1);
        return options.stdin ?? '';
      },
    },
  };
}

describe('variable sources', () => {
  it('merges file then --var with --var winning, and names every override in the provenance', async () => {
    const { context } = fakes({ files: { 'prod.env': 'API_URL=file\nDEBUG=1' } });

    const merged = await collectVariables({ vars: ['API_URL=typed', 'EXTRA=2'], envFiles: ['prod.env'] }, context);

    expect(merged.variables).toEqual([
      { key: 'API_URL', value: 'typed' },
      { key: 'DEBUG', value: '1' },
      { key: 'EXTRA', value: '2' },
    ]);
    expect(merged.added).toEqual([
      { label: 'prod.env', count: 2 },
      { label: '--var', count: 1 },
    ]);
    expect(merged.overrides).toEqual([{ label: '--var', keys: ['API_URL'] }]);
  });

  it('reads nothing from disk and prompts for nothing when only complete --var pairs are given', async () => {
    const { context, reads, prompts, stdinReads } = fakes();

    const merged = await collectVariables({ vars: ['A=1', 'B=2'], envFiles: undefined }, context);

    expect(merged.variables).toEqual([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
    expect(reads).toEqual([]);
    expect(prompts).toEqual([]);
    expect(stdinReads).toEqual([]);
  });

  it('does not auto-detect a file when --var is given, even on a command that allows it', async () => {
    const { context, reads } = fakes({ files: { '/work/.env': 'X=1' } });

    await collectVariables({ vars: ['A=1'], envFiles: undefined, autoDetect: true }, context);

    expect(reads).toEqual([]);
  });

  it('does not auto-detect when --dotenv is given', async () => {
    const { context, reads } = fakes({ files: { '/work/.env': 'X=1', 'mine.env': 'Y=2' } });

    await collectVariables({ vars: undefined, envFiles: ['mine.env'], autoDetect: true }, context);

    expect(reads).toEqual(['mine.env']);
  });

  it('auto-detects .env.local first, names the file it chose and reads only that one', async () => {
    const { context, reads, printed } = fakes({ files: { '/work/.env.local': 'A=1', '/work/.env': 'B=2' } });

    const merged = await collectVariables({ vars: undefined, envFiles: undefined, autoDetect: true }, context);

    expect(reads).toEqual(['/work/.env.local']);
    expect(printed).toContain('Using variables from /work/.env.local.');
    expect(merged.variables).toEqual([{ key: 'A', value: '1' }]);
    expect(merged.added).toEqual([{ label: '/work/.env.local', count: 1 }]);
  });

  it('falls back to .env and names it', async () => {
    const { context, printed } = fakes({ files: { '/work/.env': 'B=2' } });

    await collectVariables({ vars: undefined, envFiles: undefined, autoDetect: true }, context);

    expect(printed).toContain('Using variables from /work/.env.');
  });

  it('exits as a usage error naming --dotenv and --data-dir when nothing is detected', async () => {
    const { context } = fakes();

    await expect(
      collectVariables({ vars: undefined, envFiles: undefined, autoDetect: true }, context),
    ).rejects.toThrow(UsageError);
    await expect(
      collectVariables({ vars: undefined, envFiles: undefined, autoDetect: true }, context),
    ).rejects.toThrow(/--dotenv.*--data-dir/);
  });

  it('returns nothing when no source is given and auto-detection is off', async () => {
    const { context } = fakes({ files: { '/work/.env': 'A=1' } });

    expect(await collectVariables({ vars: undefined, envFiles: undefined }, context)).toEqual({
      variables: [],
      added: [],
      overrides: [],
    });
  });

  it('treats an empty --var list like no --var for auto-detection', async () => {
    const { context, reads } = fakes({ files: { '/work/.env': 'A=1' } });

    await collectVariables({ vars: [], envFiles: [], autoDetect: true }, context);

    expect(reads).toEqual(['/work/.env']);
  });

  it('prompts hidden for a bare key on a terminal and merges the answer', async () => {
    const { context, prompts } = fakes({ isTTY: true, answers: ['s3cret'] });

    const merged = await collectVariables({ vars: ['API_KEY'], envFiles: undefined }, context);

    expect(prompts).toEqual(['Value for API_KEY']);
    expect(merged.variables).toEqual([{ key: 'API_KEY', value: 's3cret' }]);
  });

  it('reads a lone bare key from stdin without a terminal', async () => {
    const { context } = fakes({ stdin: 'piped\n' });

    const merged = await collectVariables({ vars: ['API_KEY'], envFiles: undefined }, context);

    expect(merged.variables).toEqual([{ key: 'API_KEY', value: 'piped' }]);
  });

  it('refuses a bare key together with --dotenv - on a terminal too, before reading or asking anything', async () => {
    const { context, stdinReads, prompts } = fakes({ stdin: 'A=1', isTTY: true });

    await expect(collectVariables({ vars: ['API_KEY'], envFiles: ['-'] }, context)).rejects.toThrow(
      'only one of them can read standard input',
    );
    expect(stdinReads).toEqual([]);
    expect(prompts).toEqual([]);
  });

  it('refuses a bare key together with --dotenv - without a terminal, since both would read stdin', async () => {
    const { context, stdinReads } = fakes({ stdin: 'A=1' });

    await expect(collectVariables({ vars: ['API_KEY'], envFiles: ['-'] }, context)).rejects.toThrow(UsageError);
    await expect(collectVariables({ vars: ['API_KEY'], envFiles: ['-'] }, context)).rejects.toThrow(
      'only one of them can read standard input',
    );
    expect(stdinReads).toEqual([]);
  });

  it('reports the keys of empty file variables it skipped, never a value', async () => {
    const { context, printed } = fakes({ files: { 'a.env': 'A=1\nEMPTY=\nBLANK=  ' } });

    await collectVariables({ vars: undefined, envFiles: ['a.env'] }, context);

    expect(printed).toContain('Skipped 2 variables with an empty value in a.env: EMPTY, BLANK.');
  });

  it('uses the singular when one empty variable was skipped', async () => {
    const { context, printed } = fakes({ files: { 'a.env': 'A=1\nEMPTY=' } });

    await collectVariables({ vars: undefined, envFiles: ['a.env'] }, context);

    expect(printed).toContain('Skipped 1 variable with an empty value in a.env: EMPTY.');
  });

  it('flattens --var tokens and rejects a malformed one before reading any file', async () => {
    const { context, reads } = fakes({ files: { 'a.env': 'A=1' } });

    await expect(collectVariables({ vars: ['OK=1', 'KEY='], envFiles: ['a.env'] }, context)).rejects.toThrow(
      'KEY has an empty value.',
    );
    expect(reads).toEqual([]);
  });

  it('propagates a missing --dotenv, a cancelled prompt and a failed read', async () => {
    await expect(collectVariables({ vars: undefined, envFiles: ['nope.env'] }, fakes().context)).rejects.toThrow(
      '--dotenv nope.env was not found.',
    );
    await expect(
      collectVariables({ vars: ['A'], envFiles: undefined }, fakes({ isTTY: true, answers: [undefined as unknown as string] }).context),
    ).rejects.toThrow(CancelledError);

    const failure = new Error('EACCES');
    const { context } = fakes();

    await expect(
      collectVariables({ vars: undefined, envFiles: ['x.env'] }, { ...context, readFile: async () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
  });

  it('never prints a value', async () => {
    const { context, printed } = fakes({ files: { 'a.env': 'A=never-printed-value\nEMPTY=' } });

    await collectVariables({ vars: ['B=another_secret'], envFiles: ['a.env'] }, context);

    expect(printed.join('\n')).not.toContain('never-printed-value');
    expect(printed.join('\n')).not.toContain('another_secret');
  });

  it('merges stack, then file, then --var, naming the stack as a source and every override', async () => {
    const { context } = fakes({
      stack: [{ key: 'API_URL', value: 'from-stack' }, { key: 'REGION', value: 'eu' }, { key: 'ONLY_STACK', value: 's' }],
      files: { 'a.env': 'REGION=us\nONLY_FILE=f' },
    });

    const merged = await collectVariables({ vars: ['API_URL=typed'], envFiles: ['a.env'], fromStack: true }, context);

    expect(merged.variables).toEqual([
      { key: 'API_URL', value: 'typed' },
      { key: 'REGION', value: 'us' },
      { key: 'ONLY_STACK', value: 's' },
      { key: 'ONLY_FILE', value: 'f' },
    ]);
    expect(merged.added).toEqual([
      { label: 'stack', count: 3 },
      { label: 'a.env', count: 1 },
    ]);
    expect(merged.overrides).toEqual([
      { label: 'a.env', keys: ['REGION'] },
      { label: '--var', keys: ['API_URL'] },
    ]);
  });

  it('asks the stack importer once with the alias, after it has read every file', async () => {
    const { context, events, stackAsked } = fakes({ stack: [{ key: 'A', value: '1' }], files: { 'a.env': 'B=2' } });

    await collectVariables({ vars: undefined, envFiles: ['a.env'], fromStack: true, alias: 'my-prod' }, context);

    expect(stackAsked).toEqual(['my-prod']);
    expect(events).toEqual(['read:a.env', 'stack']);
  });

  it('fails on a missing dotenv file before it asks the stack anything', async () => {
    const { context, events } = fakes({ stack: [{ key: 'A', value: '1' }], files: {} });

    await expect(
      collectVariables({ vars: undefined, envFiles: ['missing.env'], fromStack: true }, context),
    ).rejects.toThrow('--dotenv missing.env was not found.');
    expect(events).not.toContain('stack');
  });

  it('passes no alias to the stack importer when none was given', async () => {
    const { context, stackAsked } = fakes({ stack: [{ key: 'A', value: '1' }] });

    await collectVariables({ vars: undefined, envFiles: undefined, fromStack: true }, context);

    expect(stackAsked).toEqual([undefined]);
  });

  it.each([[undefined], [false]])('never asks the stack importer when fromStack is %p', async (fromStack) => {
    const { context, stackAsked } = fakes({ stack: [{ key: 'A', value: '1' }] });

    const merged = await collectVariables({ vars: ['B=2'], envFiles: undefined, fromStack }, context);

    expect(stackAsked).toEqual([]);
    expect(merged.variables).toEqual([{ key: 'B', value: '2' }]);
  });

  it('counts --from-stack as a source, so nothing is auto-detected and a missing .env is not an error', async () => {
    const { context, reads } = fakes({ stack: [{ key: 'A', value: '1' }], files: { '/work/.env': 'X=1' } });

    const merged = await collectVariables({ vars: undefined, envFiles: undefined, autoDetect: true, fromStack: true }, context);

    expect(reads).toEqual([]);
    expect(merged.variables).toEqual([{ key: 'A', value: '1' }]);
  });

  it('propagates a failed stack import without printing anything', async () => {
    const failure = new Error('stack failed');
    const { context, reads, printed } = fakes({ stack: failure, files: { 'a.env': 'B=2' } });

    await expect(
      collectVariables({ vars: undefined, envFiles: ['a.env'], fromStack: true, alias: 'a' }, context),
    ).rejects.toBe(failure);
    expect(reads).toEqual(['a.env']);
    expect(printed).toEqual([]);
  });
});
