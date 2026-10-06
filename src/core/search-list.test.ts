import {
  SearchListClass,
  UnlistedAnswer,
  answerFor,
  launchSearchList,
  refuseUnlisted,
  registerSearchList,
  startingPointer,
  unlistedMessage,
  utilitiesLoader,
} from './search-list';

const load = utilitiesLoader();
const SearchList = load('inquirer-search-list') as SearchListClass;

interface Prompt {
  opt: { validate: (value: unknown, answers?: unknown) => unknown };
  pointer: number;
  rl: { line: string };
  selected: unknown;
  filterChoices(): void;
  getCurrentValue(line?: unknown): unknown;
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

  it('refuses the submitted line rather than answering with it when the typed text matches no choice', () => {
    const prompt = typed(open({}), 'no-such-framework-9987');
    prompt.rl.line = '';

    const submitted = prompt.getCurrentValue('no-such-framework-9987');

    expect(submitted).toEqual(new UnlistedAnswer('no-such-framework-9987'));
    expect(prompt.opt.validate(submitted)).toBe(unlistedMessage('no-such-framework-9987'));
  });

  it('refuses an empty submitted line, so Enter again after a refusal does not take the first choice', () => {
    const prompt = typed(open({}), 'no-such-framework-9987');
    prompt.rl.line = '';

    const submitted = prompt.getCurrentValue('');

    expect(submitted).toEqual(new UnlistedAnswer(''));
    expect(prompt.opt.validate(submitted)).toBe(unlistedMessage(''));
  });

  it('reads back the value it accepted, not an empty line, when asked with no line after the answer', () => {
    const prompt = typed(open({ choices: [{ name: 'Acme Corp', value: 'blt8ca9ce72e25d0172' }] }), 'blt8ca9ce72e25d0172');
    prompt.getCurrentValue('blt8ca9ce72e25d0172');
    prompt.rl.line = '';

    expect(prompt.getCurrentValue()).toBe('blt8ca9ce72e25d0172');
  });

  it('echoes the label of a value typed in full, rather than the object that refused the empty line', () => {
    const prompt = typed(open({ choices: [{ name: 'Acme Corp', value: 'blt8ca9ce72e25d0172' }] }), 'blt8ca9ce72e25d0172');
    prompt.getCurrentValue('blt8ca9ce72e25d0172');
    prompt.rl.line = '';

    prompt.selected = prompt.getCurrentValue();

    expect(prompt.selected).toBe('Acme Corp');
  });

  it('reads nothing back when asked with no line before anything was accepted', () => {
    const prompt = typed(open({}), 'no-such-framework-9987');
    prompt.rl.line = '';

    expect(prompt.getCurrentValue()).toBeUndefined();
  });

  it('submits the value of the choice whose value was typed in full, which the name filter hides', () => {
    const choices = [{ name: 'Acme Corp', value: 'blt8ca9ce72e25d0172' }];
    const prompt = typed(open({ choices }), 'blt8ca9ce72e25d0172');
    prompt.rl.line = '';

    const submitted = prompt.getCurrentValue('blt8ca9ce72e25d0172');

    expect(submitted).toBe('blt8ca9ce72e25d0172');
    expect(prompt.opt.validate(submitted)).toBe(true);
  });

  it('accepts a highlighted match without consulting the typed text', () => {
    const prompt = typed(open({}), 'Oth');

    expect(prompt.opt.validate(prompt.getCurrentValue())).toBe(true);
  });

  it('echoes the label of the chosen choice, not its value, once answered', () => {
    const prompt = open({ choices: [{ name: 'Acme Corp', value: 'blt8ca9ce72e25d0172' }] });

    prompt.selected = prompt.getCurrentValue();

    expect(prompt.selected).toBe('Acme Corp');
  });

  it('echoes the submitted value itself when it is none of the choices', () => {
    const prompt = open({});

    prompt.selected = 'no-such-framework-9987';

    expect(prompt.selected).toBe('no-such-framework-9987');
  });

  it('echoes nothing before a choice is made', () => {
    expect(open({}).selected).toBe('');
  });
});

describe('answerFor', () => {
  it('answers with the value of the choice whose name was typed in full', () => {
    expect(answerFor(CHOICES, 'NextJs')).toBe('NextJs');
  });

  it('answers with the value of the choice whose value was typed in full, even when its name differs', () => {
    expect(answerFor([{ name: 'Acme Corp', value: 'blt1' }], 'blt1')).toBe('blt1');
  });

  it('answers with an unlisted answer carrying the text when it matches no choice', () => {
    expect(answerFor(CHOICES, 'Svelte')).toEqual(new UnlistedAnswer('Svelte'));
  });

  it('does not take an empty text as a match for a choice with no name', () => {
    expect(answerFor([{ value: 'a' }], '')).toEqual(new UnlistedAnswer(''));
  });
});

describe('unlistedMessage', () => {
  it('quotes the text that matched nothing and says where to pick from', () => {
    expect(unlistedMessage('yes')).toBe('"yes" is not one of the options. Pick one from the list.');
  });

  it('asks for a choice without quoting an empty text', () => {
    expect(unlistedMessage('')).toBe('Pick one of the options from the list.');
  });
});

describe('refuseUnlisted', () => {
  it('refuses an unlisted answer with its message, without calling the validate it wraps', () => {
    const inner = jest.fn().mockReturnValue(true);

    expect(refuseUnlisted(inner)(new UnlistedAnswer('yes'))).toBe(
      '"yes" is not one of the options. Pick one from the list.',
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it('passes a listed answer, and the answers beside it, to the validate it wraps', () => {
    const inner = jest.fn().mockReturnValue(true);
    const answers = { org: 'blt1' };

    expect(refuseUnlisted(inner)('enable', answers)).toBe(true);
    expect(inner).toHaveBeenCalledWith('enable', answers);
  });

  it('keeps the refusal the wrapped validate gives a listed answer', () => {
    expect(refuseUnlisted(() => 'Too long.')('enable')).toBe('Too long.');
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
