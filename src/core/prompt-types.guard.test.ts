import { authHandler } from '@contentstack/cli-utilities';

import { LaunchCommand } from './launch-command';
import { utilitiesLoader } from './search-list';
import { SourceFile, balancedCall, productionSources } from '../../test/support/sources';

interface PromptRegistry {
  prompt: { prompts: Record<string, unknown> };
  restoreDefaultPrompts(): void;
}

interface PromptCall {
  site: string;
  type: string | undefined;
}

const FORWARDING_WRAPPERS = ['core/interruptible-ux.ts'];

class FreshCommand extends LaunchCommand {
  static flags = {};
  static inputs = {};

  async run(): Promise<void> {
    return undefined;
  }
}

function promptCalls(source: SourceFile): PromptCall[] {
  return [...source.text.matchAll(/\.inquire\s*(?:<[^(]*>)?\s*\(/g)].map((match) => {
    const index = match.index as number;
    const payload = balancedCall(source.text, index + match[0].length - 1);
    const line = source.text.slice(0, index).split('\n').length;

    return { site: `src/${source.path}:${line}`, type: /\btype:\s*'([^']+)'/.exec(payload)?.[1] };
  });
}

function promptCallsInSrc(): PromptCall[] {
  return productionSources()
    .filter((source) => !FORWARDING_WRAPPERS.includes(source.path))
    .flatMap(promptCalls);
}

async function registeredAfterAFreshLaunchCommandInit(): Promise<string[]> {
  const registry = utilitiesLoader()('inquirer') as PromptRegistry;
  const prompts = registry.prompt.prompts;
  const saved = { ...prompts };
  const instance = new FreshCommand([], {} as never);
  jest.spyOn(authHandler, 'isAuthenticated').mockReturnValue(true);
  Object.defineProperty(instance, 'launchRegion', { value: { launchHubUrl: 'https://launch-api.test' } });
  Object.defineProperty(instance, 'config', { value: { userAgent: 'cli/2.0.0' } });
  (instance as unknown as { parse: () => Promise<unknown> }).parse = async () => ({ flags: {} });

  for (const name of Object.keys(prompts)) {
    delete prompts[name];
  }

  registry.restoreDefaultPrompts();

  try {
    await instance.init();
    return Object.keys(prompts);
  } finally {
    for (const name of Object.keys(prompts)) {
      delete prompts[name];
    }

    Object.assign(prompts, saved);
  }
}

describe('guard: every prompt type the CLI asks for is registered with the real prompt library', () => {
  it('finds every prompt the CLI issues, so the guard cannot go green on an empty list', () => {
    const types = promptCallsInSrc().map((call) => call.type);

    expect(types).toEqual(expect.arrayContaining(['search-list', 'input', 'confirm']));
  });

  it('names a literal type on every prompt, so the registration check can see what each prompt needs', () => {
    const untyped = promptCallsInSrc()
      .filter((call) => call.type === undefined)
      .map((call) => `${call.site} issues a prompt payload with no literal type: '...'`);

    expect(untyped).toEqual([]);
  });

  it('registers every prompt type used anywhere in src once LaunchCommand.init has run, because inquirer silently turns an unregistered type into a plain text box', async () => {
    const calls = promptCallsInSrc();

    const registered = await registeredAfterAFreshLaunchCommandInit();

    const unregistered = calls
      .filter((call) => call.type !== undefined && !registered.includes(call.type))
      .map(
        (call) =>
          `${call.site} asks for a '${call.type}' prompt, which LaunchCommand.init never registers ` +
          'with the inquirer cliux.inquire uses - register it there or the prompt degrades to a text box',
      );
    expect(unregistered).toEqual([]);
  });

  it('starts the registration check from inquirer defaults, so a registration left behind by another test cannot satisfy it', async () => {
    const registry = utilitiesLoader()('inquirer') as PromptRegistry;
    const before = Object.keys(registry.prompt.prompts);

    const registered = await registeredAfterAFreshLaunchCommandInit();

    expect(registered).toEqual(expect.arrayContaining(['input', 'confirm', 'list', 'search-list']));
    expect(Object.keys(registry.prompt.prompts)).toEqual(before);
  });

  it('reads the type of a multi-line typed prompt call, and reports a prompt whose type is not literal', () => {
    const source: SourceFile = {
      path: 'probe/probe.prompt.ts',
      text: [
        'const a = await ux.inquire<string | undefined>({',
        '  type: \'autocomplete\',',
        '  choices: list.map((x) => ({ name: x })),',
        '});',
        'const b = await ux.inquire(payload);',
      ].join('\n'),
    };

    expect(promptCalls(source)).toEqual([
      { site: 'src/probe/probe.prompt.ts:1', type: 'autocomplete' },
      { site: 'src/probe/probe.prompt.ts:5', type: undefined },
    ]);
  });
});
