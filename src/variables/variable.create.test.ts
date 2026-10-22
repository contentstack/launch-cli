import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { variablesForCreate } from './variable.create';

const STACK = 'Import variables from a stack';
const SKIP = 'Skip adding environment variables';
const FILE = 'Import variables from a dotenv file';
const TYPED = 'Type KEY=VALUE pairs';

function fakes(options: { isTTY?: boolean; answers?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const files = options.files ?? {};
  const printed: string[] = [];
  const asked: { message: string; payload: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  const stdinReads: number[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: (async (payload: Record<string, unknown>) => {
      const message = String(payload.message);
      asked.push({ message, payload });

      if (!(message in (options.answers ?? {}))) {
        throw new Error(`Unexpected prompt: ${message}`);
      }

      return (options.answers ?? {})[message];
    }) as UxLike['inquire'],
  };

  return {
    printed,
    asked,
    reads,
    stdinReads,
    services: {
      ux,
      isTTY: options.isTTY ?? true,
      outputIsTTY: false,
      api: {
        stacks: {
          list: async () => [{ name: 'Shop', apiKey: 'blt1' }],
          deliveryTokens: async () => [{ name: 'prod-token', token: 'cs-picked-value', environment: 'production' }],
        },
        variables: { stackTemplate: async () => [{ key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' }] },
      },
    } as unknown as ServiceContext,
    io: {
      readFile: async (path: string) => {
        reads.push(path);

        if (!(path in files)) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }

        return files[path];
      },
      exists: (path: string) => path in files,
      readStdin: async () => {
        stdinReads.push(1);
        return '';
      },
    },
  };
}

const NONE = { vars: undefined, envFiles: undefined, dataDir: '/work', org: 'org1' };

describe('variable create', () => {
  it('uses the flags as given, never asks, never auto-detects, and prints the provenance', async () => {
    const { services, io, asked, reads, printed } = fakes({ files: { 'a.env': 'FROM_FILE=1', '/work/.env': 'X=1' } });

    const variables = await variablesForCreate({ vars: ['TYPED=2'], envFiles: ['a.env'], dataDir: '/work', org: 'org1' }, services, io);

    expect(variables).toEqual([
      { key: 'FROM_FILE', value: '1' },
      { key: 'TYPED', value: '2' },
    ]);
    expect(asked).toEqual([]);
    expect(reads).toEqual(['a.env']);
    expect(printed).toEqual(['✔ 2 variables ready to set — 1 from a.env, 1 from --var']);
  });

  it('returns nothing without a terminal and without flags, asking nothing and reading nothing', async () => {
    const { services, io, asked, reads, printed } = fakes({ isTTY: false, files: { '/work/.env': 'X=1' } });

    expect(await variablesForCreate(NONE, services, io)).toEqual([]);
    expect(asked).toEqual([]);
    expect(reads).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('treats empty flag lists as no flags', async () => {
    const { services, io, asked } = fakes({ answers: { 'Add environment variables': [SKIP] } });

    expect(await variablesForCreate({ vars: [], envFiles: [], dataDir: '/work', org: 'org1' }, services, io)).toEqual([]);
    expect(asked.map((entry) => entry.message)).toEqual(['Add environment variables']);
  });

  it('offers a checkbox of the sources and Skip as the last choice', async () => {
    const { services, io, asked } = fakes({ answers: { 'Add environment variables': [SKIP] } });

    await variablesForCreate(NONE, services, io);

    expect(asked[0].payload).toMatchObject({
      type: 'checkbox',
      choices: [
        { name: STACK, value: STACK },
        { name: FILE, value: FILE },
        { name: TYPED, value: TYPED },
        { name: SKIP, value: SKIP },
      ],
    });
  });

  it('returns nothing and says so when Skip is chosen', async () => {
    const { services, io, printed } = fakes({ answers: { 'Add environment variables': [SKIP] } });

    expect(await variablesForCreate(NONE, services, io)).toEqual([]);
    expect(printed).toEqual(['Skipped adding environment variables.']);
  });

  it('refuses Skip combined with another choice as a usage error before asking anything else', async () => {
    const { services, io, asked } = fakes({ answers: { 'Add environment variables': [SKIP, FILE] } });

    await expect(variablesForCreate(NONE, services, io)).rejects.toThrow(UsageError);
    await expect(variablesForCreate(NONE, services, io)).rejects.toThrow(
      "'Skip adding environment variables' cannot be combined with the other options.",
    );
    expect(asked.map((entry) => entry.message)).toEqual(['Add environment variables', 'Add environment variables']);
  });

  it('asks for a dotenv path defaulting to the detected file and reads it', async () => {
    const { services, io, asked, reads, printed } = fakes({
      files: { '/work/.env.local': 'A=1', '/work/other.env': 'B=2' },
      answers: { 'Add environment variables': [FILE], 'Path to the dotenv file': '/work/other.env' },
    });

    const variables = await variablesForCreate(NONE, services, io);

    expect(asked[1].payload).toMatchObject({ default: '/work/.env.local' });
    expect(reads).toEqual(['/work/other.env']);
    expect(variables).toEqual([{ key: 'B', value: '2' }]);
    expect(printed).toEqual(['✔ 1 variable ready to set — 1 from /work/other.env']);
  });

  it('reports the empty-value entries of a dotenv file it was pointed at, as the flag path does', async () => {
    const { services, io, printed } = fakes({
      files: { 'x.env': 'A=1\nSECRET=\n' },
      answers: { 'Add environment variables': [FILE], 'Path to the dotenv file': 'x.env' },
    });

    const variables = await variablesForCreate(NONE, services, io);

    expect(variables).toEqual([{ key: 'A', value: '1' }]);
    expect(printed).toContain('Skipped 1 variable with an empty value in x.env: SECRET.');
  });

  it('offers no default path when no dotenv file is detected', async () => {
    const { services, io, asked } = fakes({
      files: { 'x.env': 'A=1' },
      answers: { 'Add environment variables': [FILE], 'Path to the dotenv file': 'x.env' },
    });

    await variablesForCreate(NONE, services, io);

    expect(asked[1].payload.default).toBeUndefined();
  });

  it('parses a typed line with quotes, merges it after the file and names the override without printing a value', async () => {
    const { services, io, printed } = fakes({
      files: { 'a.env': 'API_URL=file\nF=1' },
      answers: {
        'Add environment variables': [FILE, TYPED],
        'Path to the dotenv file': 'a.env',
        'KEY=VALUE pairs separated by spaces': 'API_URL="sk live secret" N=2',
      },
    });

    const variables = await variablesForCreate(NONE, services, io);

    expect(variables).toEqual([
      { key: 'API_URL', value: 'sk live secret' },
      { key: 'F', value: '1' },
      { key: 'N', value: '2' },
    ]);
    expect(printed.join('\n')).toContain('API_URL overridden by --var');
    expect(printed.join('\n')).not.toContain('sk live secret');
  });

  it('asks a hidden prompt for a typed key that has no value', async () => {
    const { services, io, asked } = fakes({
      answers: {
        'Add environment variables': [TYPED],
        'KEY=VALUE pairs separated by spaces': 'API_KEY',
        'Value for API_KEY': 's3cret',
      },
    });

    const variables = await variablesForCreate(NONE, services, io);

    expect(variables).toEqual([{ key: 'API_KEY', value: 's3cret' }]);
    expect(asked[2].payload).toMatchObject({ type: 'password' });
  });

  it('echoes the typed keys with masked values and never a value', async () => {
    const { services, io, printed } = fakes({
      answers: { 'Add environment variables': [TYPED], 'KEY=VALUE pairs separated by spaces': 'A=never-printed-value' },
    });

    await variablesForCreate(NONE, services, io);

    const output = printed.join('\n');

    expect(output).toContain('A');
    expect(output).toContain('••••••');
    expect(output).not.toContain('never-printed-value');
  });

  it.each([[undefined], [[]]])('returns nothing and prints no summary when nothing was selected (%p)', async (answer) => {
    const { services, io, printed } = fakes({ answers: { 'Add environment variables': answer } });

    expect(await variablesForCreate(NONE, services, io)).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('propagates a cancelled path prompt, an unreadable file and a malformed typed line', async () => {
    const cancelled = fakes({ answers: { 'Add environment variables': [FILE], 'Path to the dotenv file': undefined } });

    await expect(variablesForCreate(NONE, cancelled.services, cancelled.io)).rejects.toThrow(CancelledError);

    const missing = fakes({ answers: { 'Add environment variables': [FILE], 'Path to the dotenv file': 'nope.env' } });

    await expect(variablesForCreate(NONE, missing.services, missing.io)).rejects.toThrow(
      '--dotenv nope.env was not found.',
    );

    const malformed = fakes({
      answers: { 'Add environment variables': [TYPED], 'KEY=VALUE pairs separated by spaces': 'A="oops' },
    });

    await expect(variablesForCreate(NONE, malformed.services, malformed.io)).rejects.toThrow(
      'The line has an opening quote with no closing quote.',
    );
  });

  it('imports through --from-stack and --alias without asking, merging it before a typed --var', async () => {
    const { services, io, asked, printed } = fakes();
    const savedToken = (alias: string) =>
      alias === 'my-prod' ? { token: 'cs-saved-value', apiKey: 'blt9', environment: 'staging' } : undefined;

    const variables = await variablesForCreate(
      { vars: ['CONTENTSTACK_ENVIRONMENT=override'], envFiles: undefined, dataDir: '/work', org: 'org1', fromStack: true, alias: 'my-prod' },
      services,
      io,
      savedToken,
    );

    expect(variables).toEqual([
      { key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' },
      { key: 'CONTENTSTACK_API_KEY', value: 'blt9' },
      { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: 'cs-saved-value' },
      { key: 'CONTENTSTACK_ENVIRONMENT', value: 'override' },
    ]);
    expect(asked).toEqual([]);
    expect(printed).toEqual([
      'Using the saved delivery token "my-prod" (environment staging).',
      'No value was available for CONTENTSTACK_CDN, so it was not imported.',
      '\u2714 4 variables ready to set \u2014 4 from stack, CONTENTSTACK_ENVIRONMENT overridden by --var',
    ]);
    expect(printed.join('\n')).not.toContain('cs-saved-value');
  });

  it('refuses --from-stack without --alias when there is no terminal, asking nothing', async () => {
    const { services, io, asked } = fakes({ isTTY: false });

    await expect(
      variablesForCreate({ vars: undefined, envFiles: undefined, dataDir: '/work', org: 'org1', fromStack: true }, services, io),
    ).rejects.toThrow("--from-stack requires --alias when there's no TTY.");
    expect(asked).toEqual([]);
  });

  it('offers the stack as a source, asks the stack and token pickers, and merges it before the other sources', async () => {
    const { services, io, asked, printed } = fakes({
      answers: {
        'Add environment variables': [STACK, TYPED],
        Stack: '0',
        'Delivery token': '0',
        'KEY=VALUE pairs separated by spaces': 'EXTRA=1',
      },
    });

    const variables = await variablesForCreate(NONE, services, io);

    expect(asked.map((entry) => entry.message)).toEqual([
      'Add environment variables',
      'Stack',
      'Delivery token',
      'KEY=VALUE pairs separated by spaces',
    ]);
    expect(variables.map((variable) => variable.key)).toEqual([
      'CONTENTSTACK_API_HOST',
      'CONTENTSTACK_API_KEY',
      'CONTENTSTACK_DELIVERY_TOKEN',
      'CONTENTSTACK_ENVIRONMENT',
      'EXTRA',
    ]);
    expect(printed.join('\n')).toContain('4 from stack');
    expect(printed.join('\n')).not.toContain('cs-picked-value');
  });

  it('refuses Skip combined with the stack choice', async () => {
    const { services, io } = fakes({ answers: { 'Add environment variables': [SKIP, STACK] } });

    await expect(variablesForCreate(NONE, services, io)).rejects.toThrow(
      "'Skip adding environment variables' cannot be combined with the other options.",
    );
  });
});
