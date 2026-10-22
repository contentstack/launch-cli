import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { Environment, EnvironmentUpdate } from '../environments/types';
import { DEFAULT_VARIABLE_IO } from './variable.io';
import { VariableSetter } from './variable.set';
import type { SavedToken } from './variable.stack';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

function fakes(
  held: Environment = { environmentVariables: [{ key: 'KEEP', value: 'k' }] },
  files: Record<string, string> = {},
  answers?: Record<string, unknown>,
) {
  const asked: { message: string; payload: Record<string, unknown> }[] = [];
  const printed: string[] = [];
  const order: string[] = [];
  const updates: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: (async (payload: { message: string }) => {
      asked.push({ message: payload.message, payload: payload as unknown as Record<string, unknown> });
      return (answers ?? {})[payload.message];
    }) as UxLike['inquire'],
  };
  const services = {
    ux,
    isTTY: answers !== undefined,
    outputIsTTY: false,
    api: {
      environments: {
        get: async (params: unknown) => {
          order.push('get');
          updates.push(params);
          return held;
        },
        update: async (params: { update: EnvironmentUpdate }) => {
          order.push('update');
          updates.push(params);
          return { ...held, environmentVariables: params.update.environmentVariables };
        },
      },
    },
  } as unknown as ServiceContext;
  const io = {
    readFile: async (path: string) => {
      order.push(`read:${path}`);

      if (!(path in files)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }

      return files[path];
    },
    exists: (path: string) => path in files,
    readStdin: async () => '',
  };

  return { printed, order, updates, asked, setter: new VariableSetter(services, io) };
}

describe('variable setter', () => {
  it('gathers every source before it reads the environment, then reads, writes and prints the provenance', async () => {
    const { setter, order, printed, updates } = fakes(undefined, { 'a.env': 'FROM_FILE=1' });

    await setter.set({ ...SCOPE, vars: ['TYPED=2'], envFiles: ['a.env'], dataDir: '/work' });

    expect(order).toEqual(['read:a.env', 'get', 'update']);
    expect(updates[1]).toEqual({
      ...SCOPE,
      update: {
        environmentVariables: [
          { key: 'KEEP', value: 'k' },
          { key: 'FROM_FILE', value: '1' },
          { key: 'TYPED', value: '2' },
        ],
      },
    });
    expect(printed).toEqual(['✔ 2 variables set — 1 from a.env, 1 from --var']);
  });

  it('auto-detects a file under the data directory when no source is given and names it', async () => {
    const { setter, printed, updates } = fakes(undefined, { '/work/.env.local': 'A=1' });

    await setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work' });

    expect(printed).toEqual(['Using variables from /work/.env.local.', '✔ 1 variable set — 1 from /work/.env.local']);
    expect((updates[1] as { update: EnvironmentUpdate }).update.environmentVariables).toEqual([
      { key: 'KEEP', value: 'k' },
      { key: 'A', value: '1' },
    ]);
  });

  it('prints no changes made and never reads the environment when the sources hold nothing', async () => {
    const { setter, printed, order } = fakes(undefined, { 'empty.env': '# nothing' });

    await setter.set({ ...SCOPE, vars: undefined, envFiles: ['empty.env'], dataDir: '/work' });

    expect(printed).toEqual(['No changes made.']);
    expect(order).toEqual(['read:empty.env']);
  });

  it('names an override in the summary', async () => {
    const { setter, printed } = fakes(undefined, { 'a.env': 'API_URL=file' });

    await setter.set({ ...SCOPE, vars: ['API_URL=typed'], envFiles: ['a.env'], dataDir: '/work' });

    expect(printed).toEqual(['✔ 1 variable set — 1 from a.env, API_URL overridden by --var']);
  });

  it('writes nothing and prints no summary when a source fails', async () => {
    const { setter, printed, order } = fakes();

    await expect(setter.set({ ...SCOPE, vars: ['KEY='], envFiles: undefined, dataDir: '/work' })).rejects.toThrow(
      'KEY has an empty value.',
    );
    expect(order).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('prints no summary when the write fails', async () => {
    const printed: string[] = [];
    const failing = new VariableSetter(
      {
        ux: { print: (message: string) => printed.push(message), inquire: async () => undefined as never },
        isTTY: false,
        outputIsTTY: false,
        api: {
          environments: {
            get: async () => ({}),
            update: async () => Promise.reject(new Error('update failed')),
          },
        },
      } as unknown as ServiceContext,
      { readFile: async () => '', exists: () => false, readStdin: async () => '' },
    );

    await expect(failing.set({ ...SCOPE, vars: ['A=1'], envFiles: undefined, dataDir: '/work' })).rejects.toThrow(
      'update failed',
    );
    expect(printed).toEqual([]);
  });

  it('never prints a value', async () => {
    const { setter, printed } = fakes(undefined, { 'a.env': 'A=never-printed-value' });

    await setter.set({ ...SCOPE, vars: ['B=another_secret'], envFiles: ['a.env'], dataDir: '/work' });

    expect(printed.join('\n')).not.toContain('never-printed-value');
    expect(printed.join('\n')).not.toContain('another_secret');
  });
});

describe('variable setter with --from-stack', () => {
  function stackSetter(saved: SavedToken | undefined) {
    const printed: string[] = [];
    const templateAsked: string[] = [];
    const aliasAsked: string[] = [];
    const updates: unknown[] = [];
    const services = {
      ux: { print: (message: string) => printed.push(message), inquire: async () => undefined as never },
      isTTY: false,
      outputIsTTY: false,
      api: {
        variables: {
          stackTemplate: async (org: string) => {
            templateAsked.push(org);
            return [{ key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' }];
          },
        },
        environments: {
          get: async () => ({ environmentVariables: [{ key: 'KEEP', value: 'k' }] }),
          update: async (params: unknown) => {
            updates.push(params);
            return {};
          },
        },
      },
    } as unknown as ServiceContext;
    const io = { readFile: async () => '', exists: () => false, readStdin: async () => '' };
    const setter = new VariableSetter(services, io, (alias) => {
      aliasAsked.push(alias);
      return saved;
    });

    return { setter, printed, templateAsked, aliasAsked, updates };
  }

  it('imports through the saved token under the alias for the same organization, merges it in and names the stack', async () => {
    const { setter, printed, templateAsked, aliasAsked, updates } = stackSetter({
      token: 'cs-secret-token',
      apiKey: 'blt9',
      environment: 'staging',
    });

    await setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work', fromStack: true, alias: 'my-prod' });

    expect(aliasAsked).toEqual(['my-prod']);
    expect(templateAsked).toEqual(['org1']);
    expect((updates[0] as { update: { environmentVariables: unknown } }).update.environmentVariables).toEqual([
      { key: 'KEEP', value: 'k' },
      { key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' },
      { key: 'CONTENTSTACK_API_KEY', value: 'blt9' },
      { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: 'cs-secret-token' },
      { key: 'CONTENTSTACK_ENVIRONMENT', value: 'staging' },
    ]);
    expect(printed).toEqual([
      'Using the saved delivery token "my-prod" (environment staging).',
      'No value was available for CONTENTSTACK_CDN, so it was not imported.',
      '\u2714 4 variables set \u2014 4 from stack',
    ]);
    expect(printed.join('\n')).not.toContain('cs-secret-token');
  });

  it('writes nothing when the alias has no saved token', async () => {
    const { setter, printed, updates } = stackSetter(undefined);

    await expect(
      setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work', fromStack: true, alias: 'gone' }),
    ).rejects.toThrow('No delivery token is saved as "gone".');
    expect(updates).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('refuses --from-stack without --alias when there is no terminal, writing nothing', async () => {
    const { setter, updates } = stackSetter(undefined);

    await expect(
      setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work', fromStack: true }),
    ).rejects.toThrow("--from-stack requires --alias when there's no TTY.");
    expect(updates).toEqual([]);
  });
});

describe('default variable io', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'launch-variable-io-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads a file as utf8 text', async () => {
    const path = join(directory, 'a.env');
    writeFileSync(path, 'A=caf\u00e9\n');

    expect(await DEFAULT_VARIABLE_IO.readFile(path)).toBe('A=caf\u00e9\n');
  });

  it('rejects reading a file that does not exist with the not-found code', async () => {
    await expect(DEFAULT_VARIABLE_IO.readFile(join(directory, 'missing.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports whether a path exists', () => {
    const path = join(directory, 'a.env');
    writeFileSync(path, 'A=1');

    expect(DEFAULT_VARIABLE_IO.exists(path)).toBe(true);
    expect(DEFAULT_VARIABLE_IO.exists(join(directory, 'missing.env'))).toBe(false);
  });

  it('reads everything piped on standard input', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: Readable.from(['A=1\n', 'B=2\n']), configurable: true });

    try {
      expect(await DEFAULT_VARIABLE_IO.readStdin()).toBe('A=1\nB=2\n');
    } finally {
      Object.defineProperty(process, 'stdin', original as PropertyDescriptor);
    }
  });

  describe('asking which sources to use', () => {
    const STACK = 'Import variables from a stack';
    const FILE = 'Import variables from a dotenv file';
    const TYPED = 'Type KEY=VALUE pairs';

    it('offers the three sources, with no Skip, on a terminal when no source flag was given', async () => {
      const { setter, asked } = fakes(undefined, {}, { 'Add variables from': [] });

      await setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work' });

      expect(asked).toHaveLength(1);
      expect(asked[0].payload).toMatchObject({
        type: 'checkbox',
        message: 'Add variables from',
        choices: [
          { name: STACK, value: STACK },
          { name: FILE, value: FILE },
          { name: TYPED, value: TYPED },
        ],
      });
    });

    it('names the detected dotenv file in its choice', async () => {
      const { setter, asked } = fakes(undefined, { '/work/.env.local': 'A=1' }, { 'Add variables from': [] });

      await setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work' });

      expect(asked[0].payload).toMatchObject({
        choices: [{ name: STACK }, { name: `${FILE} (.env.local found)`, value: FILE }, { name: TYPED }],
      });
    });

    it('says it skipped adding variables, and never reads the environment, when nothing is ticked', async () => {
      const { setter, printed, order } = fakes(undefined, {}, { 'Add variables from': [] });

      await setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work' });

      expect(printed).toEqual(['Skipped adding variables.']);
      expect(order).toEqual([]);
    });

    it('sets what the ticked sources supply and prints the provenance', async () => {
      const { setter, printed, updates, order } = fakes(
        undefined,
        { '/work/.env.local': 'FROM_FILE=1' },
        {
          'Add variables from': [FILE, TYPED],
          'Path to the dotenv file': '/work/.env.local',
          'KEY=VALUE pairs separated by spaces': 'TYPED=2',
        },
      );

      await setter.set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work' });

      expect(order).toEqual(['read:/work/.env.local', 'get', 'update']);
      expect((updates[1] as { update: EnvironmentUpdate }).update.environmentVariables).toEqual([
        { key: 'KEEP', value: 'k' },
        { key: 'FROM_FILE', value: '1' },
        { key: 'TYPED', value: '2' },
      ]);
      expect(printed.at(-1)).toBe('✔ 2 variables set — 1 from /work/.env.local, 1 from --var');
    });

    it.each([
      [{ vars: ['A=1'] }],
      [{ envFiles: ['a.env'] }],
      [{ fromStack: true, alias: 'prod' }],
    ])('does not ask when a source flag was given (%p)', async (flags) => {
      const { setter, asked } = fakes(undefined, { 'a.env': 'FROM_FILE=1' }, {});

      await setter
        .set({ ...SCOPE, vars: undefined, envFiles: undefined, dataDir: '/work', ...flags })
        .catch(() => undefined);

      expect(asked).toEqual([]);
    });
  });
});
