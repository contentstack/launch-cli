import { SearchListClass, launchSearchList, registerSearchList, startingPointer, utilitiesLoader } from './search-list';

const load = utilitiesLoader();
const SearchList = load('inquirer-search-list') as SearchListClass;

interface Prompt {
  pointer: number;
  rl: { line: string };
  filterChoices(): void;
  getCurrentValue(): unknown;
}

const CHOICES = [
  { name: 'Gatsby', value: 'Gatsby' },
  { name: 'NextJs', value: 'NextJs' },
  { name: 'Other', value: 'Other' },
];

function open(question: Record<string, unknown>, line = ''): Prompt {
  const Prompt = launchSearchList(SearchList) as unknown as new (question: unknown, rl: unknown) => Prompt;

  return new Prompt({ name: 'value', message: 'Framework preset', choices: CHOICES, ...question }, { line });
}

function typed(prompt: Prompt, text: string): Prompt {
  prompt.rl.line = text;
  prompt.filterChoices();
  return prompt;
}

describe('startingPointer', () => {
  it('points at the choice whose value is the default', () => {
    expect(startingPointer(CHOICES, 'Other')).toBe(2);
  });

  it('points at the first choice when there is no default', () => {
    expect(startingPointer(CHOICES, undefined)).toBe(0);
  });

  it('points at the first choice when the default is not one of the choices', () => {
    expect(startingPointer(CHOICES, 'Svelte')).toBe(0);
  });

  it('does not take an undefined default as a match for a choice with an undefined value', () => {
    expect(startingPointer([{ value: 'a' }, { value: undefined }], undefined)).toBe(0);
  });
});

describe('launchSearchList', () => {
  it('highlights the offered default so Enter accepts it', () => {
    const prompt = open({ default: 'NextJs' });

    expect(prompt.pointer).toBe(1);
    expect(prompt.getCurrentValue()).toBe('NextJs');
  });

  it('highlights the first choice when nothing is offered as the default', () => {
    const prompt = open({});

    expect(prompt.pointer).toBe(0);
    expect(prompt.getCurrentValue()).toBe('Gatsby');
  });

  it('submits the highlighted match of what was typed', () => {
    const prompt = typed(open({}), 'Oth');

    expect(prompt.getCurrentValue()).toBe('Other');
  });

  it('submits the typed text rather than the first choice when the text matches nothing', () => {
    const prompt = typed(open({}), 'no-such-framework-9987');

    expect(prompt.getCurrentValue()).toBe('no-such-framework-9987');
  });
});

describe('registerSearchList', () => {
  it('registers the launch search list under search-list on the inquirer that cliux prompts with', () => {
    const registered: [string, unknown][] = [];
    const loaded: string[] = [];
    const fakeLoad = (id: string): unknown => {
      loaded.push(id);
      return id === 'inquirer' ? { registerPrompt: (name: string, prompt: unknown) => registered.push([name, prompt]) } : SearchList;
    };

    registerSearchList(fakeLoad);

    expect(loaded).toEqual(['inquirer', 'inquirer-search-list']);
    expect(registered).toHaveLength(1);
    expect(registered[0][0]).toBe('search-list');
    expect((registered[0][1] as SearchListClass).prototype).toBeInstanceOf(SearchList);
    expect(registered[0][1]).not.toBe(SearchList);
  });

  it('registers on the real inquirer cli-utilities depends on when no loader is given', () => {
    const inquirer = load('inquirer') as { prompt: { prompts: Record<string, unknown> } };

    registerSearchList();

    expect((inquirer.prompt.prompts['search-list'] as SearchListClass).prototype).toBeInstanceOf(SearchList);
  });
});
