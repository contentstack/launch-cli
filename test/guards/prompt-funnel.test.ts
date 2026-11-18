import { EXIT_CANCELLED } from '../../src/core/constants';
import { CancelledError } from '../../src/core/errors';
import { LaunchCommand } from '../../src/core/launch-command';
import type { UxLike } from '../../src/core/prompt';
import { terminalUx } from '../../src/core/terminal-ux';
import type { Occurrence, SourceFile } from '../support/sources';
import { describeOccurrence, occurrences, productionSources } from '../support/sources';
import { ctrlC } from '../support/terminal';

const FUNNEL_FILE = 'core/launch-command.ts';
const FUNNEL_CALL = 'cancelOnInterrupt(terminalUx)';
const REGISTRATION_FILE = 'core/search-list.ts';
const TERMINAL_FILE = 'core/terminal-ux.ts';
const PROMPT_LIBRARIES = /['"](inquirer|inquirer-[\w-]+|@inquirer\/[\w-]+|enquirer|prompts|(node:)?readline)['"]/;
const PROMPT_METHODS = 'inquire|prompt|confirm';

class FreshCommand extends LaunchCommand {
  static flags = {};
  static inputs = {};

  async run(): Promise<void> {
    return undefined;
  }
}

function cliuxNames(source: SourceFile): string[] {
  const imports = [...source.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@contentstack\/cli-utilities'/g)];

  return imports.flatMap((match) =>
    match[1]
      .split(',')
      .map((specifier) => specifier.trim().split(/\s+as\s+/))
      .filter(([imported]) => imported === 'cliux')
      .map((parts) => parts[parts.length - 1]),
  );
}

function isImport(use: Occurrence): boolean {
  return /^import\b/.test(use.text);
}

function isTheFunnel(use: Occurrence): boolean {
  return use.path === FUNNEL_FILE && use.text.includes(FUNNEL_CALL);
}

function detours(source: SourceFile): Occurrence[] {
  const direct = cliuxNames(source).flatMap((name) => [
    ...occurrences(source, new RegExp(`\\b${name}\\s*(\\??\\.)\\s*(${PROMPT_METHODS})\\b`)),
    ...occurrences(source, new RegExp(`\\b${name}\\b(?!\\s*\\??\\.)`)).filter((use) => !isImport(use)),
  ]);
  const libraries = source.path === REGISTRATION_FILE ? [] : occurrences(source, PROMPT_LIBRARIES);
  const registrationPrompts =
    source.path === REGISTRATION_FILE ? occurrences(source, new RegExp(`\\.(${PROMPT_METHODS})\\s*\\(`)) : [];
  const libraryCalls = [REGISTRATION_FILE, TERMINAL_FILE].includes(source.path)
    ? []
    : occurrences(source, /\bpromptLibrary\b/).filter((use) => !isImport(use));
  const unwrappedTerminal =
    source.path === TERMINAL_FILE
      ? []
      : occurrences(source, /\bterminalUx\b/).filter((use) => !isImport(use) && !isTheFunnel(use));
  const wholeModule = [
    ...occurrences(source, /import\s*\*\s*as\s+\w+\s+from\s*'@contentstack\/cli-utilities'/),
    ...occurrences(source, /\brequire\(\s*'@contentstack\/cli-utilities'/),
  ];

  return [...direct, ...libraries, ...registrationPrompts, ...libraryCalls, ...unwrappedTerminal, ...wholeModule];
}

function promptDetoursIn(sources: SourceFile[]): string[] {
  return sources.flatMap((source) =>
    detours(source).map(
      (detour) =>
        `${describeOccurrence(detour)}  <- reaches the prompt library around ${FUNNEL_CALL}; prompt through ` +
        'this.ux / services.ux so Ctrl-C exits 3 as cancelled instead of 130',
    ),
  );
}

describe('guard: every prompt goes through the one wrapper that maps Ctrl-C to exit 3', () => {
  it('finds no source in src that prompts through cliux or a prompt library directly', () => {
    expect(promptDetoursIn(productionSources())).toEqual([]);
  });

  it('builds the command ux from terminalUx exactly once, through the Ctrl-C wrapper', () => {
    const funnels = productionSources().flatMap((source) =>
      occurrences(source, /(?<!function )cancelOnInterrupt\(/).map((use) => `${use.path}  ${use.text}`),
    );

    expect(funnels).toEqual([`${FUNNEL_FILE}  protected ux: UxLike = ${FUNNEL_CALL};`]);
  });

  it('turns Ctrl-C at any prompt a LaunchCommand issues into CancelledError with exit 3', async () => {
    jest.spyOn(terminalUx, 'inquire').mockRejectedValue(ctrlC());
    const ux = (new FreshCommand([], {} as never) as unknown as { ux: UxLike }).ux;

    const answer = ux.inquire({ type: 'input', name: 'value', message: 'Project name' });

    await expect(answer).rejects.toBeInstanceOf(CancelledError);
    await expect(answer).rejects.toHaveProperty('exitCode', EXIT_CANCELLED);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('names every way around the wrapper, so the source check cannot go green vacuously', () => {
    const sources: SourceFile[] = [
      {
        path: 'deployments/deployment.picker.ts',
        text: [
          'import { cliux as terminal, configHandler } from \'@contentstack/cli-utilities\';',
          'const answer = await terminal.inquire({ type: \'list\', name: \'x\' });',
          'const ux: UxLike = terminal;',
        ].join('\n'),
      },
      { path: 'variables/variable.prompt.ts', text: 'import inquirer from \'inquirer\';' },
      { path: 'cache/cache.prompt.ts', text: 'const rl = createInterface(require(\'node:readline\'));' },
      { path: 'logs/logs.prompt.ts', text: 'import * as utilities from \'@contentstack/cli-utilities\';' },
      { path: 'core/search-list.ts', text: 'await load(\'inquirer\').prompt([question]);' },
      { path: 'core/launch-command.ts', text: 'protected ux: UxLike = cliux;\nimport { cliux } from \'@contentstack/cli-utilities\';' },
      { path: 'cache/purge.prompt.ts', text: 'const answers = await promptLibrary().prompt(question);' },
      { path: 'environments/environment.prompt.ts', text: 'const name = await terminalUx.inquire(question);' },
      { path: 'deployments/deployment.prompt.ts', text: 'const ux = libraryUx(promptLibrary, print);' },
    ];

    expect(promptDetoursIn(sources).map((detour) => detour.split('  <-')[0])).toEqual([
      'src/deployments/deployment.picker.ts:2  const answer = await terminal.inquire({ type: \'list\', name: \'x\' });',
      'src/deployments/deployment.picker.ts:3  const ux: UxLike = terminal;',
      'src/variables/variable.prompt.ts:1  import inquirer from \'inquirer\';',
      'src/cache/cache.prompt.ts:1  const rl = createInterface(require(\'node:readline\'));',
      'src/logs/logs.prompt.ts:1  import * as utilities from \'@contentstack/cli-utilities\';',
      'src/core/search-list.ts:1  await load(\'inquirer\').prompt([question]);',
      'src/core/launch-command.ts:1  protected ux: UxLike = cliux;',
      'src/cache/purge.prompt.ts:1  const answers = await promptLibrary().prompt(question);',
      'src/environments/environment.prompt.ts:1  const name = await terminalUx.inquire(question);',
      'src/deployments/deployment.prompt.ts:1  const ux = libraryUx(promptLibrary, print);',
    ]);
  });

  it('allows printing through cliux and registering a prompt type, which never prompt', () => {
    const sources: SourceFile[] = [
      {
        path: 'functions/function.logger.ts',
        text: 'import { cliux as ux, PrintOptions } from \'@contentstack/cli-utilities\';\nux.print(line, {});',
      },
      {
        path: 'core/search-list.ts',
        text: 'const inquirer = load(\'inquirer\');\ninquirer.registerPrompt(\'search-list\', SearchList);',
      },
      {
        path: 'core/terminal-ux.ts',
        text: 'export const terminalUx: UxLike = libraryUx(promptLibrary, (message) => cliux.print(message));',
      },
    ];

    expect(promptDetoursIn(sources)).toEqual([]);
  });
});
