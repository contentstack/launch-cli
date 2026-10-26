import { PROMPT_PAGE_SIZE } from './prompt';
import type { SearchListClass } from './search-list';
import {
  MORE_CHOICES_HINT,
  UnlistedAnswer,
  answerFor,
  launchPaginated,
  launchSearchList,
  refuseUnlisted,
  registerSearchList,
  pageScroller,
  startingPointer,
  unlistedMessage,
  utilitiesLoader,
} from './search-list';

const load = utilitiesLoader();
const SearchList = load('inquirer-search-list') as SearchListClass;

interface Prompt {
  opt: { validate: (value: unknown, answers?: unknown) => unknown; pageSize?: number };
  pointer: number;
  paginator: { paginate(output: string, active: number, pageSize?: number): string };
  render(): void;
  onDownKey(): void;
  onUpKey(): void;
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

  it('stops at the last choice instead of wrapping round to the first', () => {
    const prompt = open({ default: 'Other' });
    prompt.render = jest.fn();

    prompt.onDownKey();

    expect(prompt.pointer).toBe(2);
    expect(prompt.render).toHaveBeenCalled();
  });

  it('stops at the first choice instead of wrapping round to the last', () => {
    const prompt = open({});
    prompt.render = jest.fn();

    prompt.onUpKey();

    expect(prompt.pointer).toBe(0);
  });

  it('still moves between choices inside the list', () => {
    const prompt = open({});
    prompt.render = jest.fn();

    prompt.onDownKey();
    prompt.onDownKey();
    prompt.onUpKey();

    expect(prompt.pointer).toBe(1);
  });

  it('stops at the last match of what was typed', () => {
    const prompt = typed(open({}), 'Oth');
    prompt.render = jest.fn();

    prompt.onDownKey();

    expect(prompt.pointer).toBe(0);
  });

  it('shows PROMPT_PAGE_SIZE choices at a time through the page scroller', () => {
    const prompt = open({});

    expect(prompt.opt.pageSize).toBe(PROMPT_PAGE_SIZE);
    expect(prompt.paginator.paginate(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'), 0)).toContain(MORE_CHOICES_HINT);
  });

  it('keeps a page size the question sets itself', () => {
    expect(open({ pageSize: 3 }).opt.pageSize).toBe(3);
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

describe('pageScroller', () => {
  const LINES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
  const HINT = '\u001b[2m(Use ↑/↓ to see more options)\u001b[22m';

  function walk(...actives: number[]): string[][] {
    const scroller = pageScroller();

    return actives.map((active) => scroller.paginate(LINES, active, 5).split('\n'));
  }

  it('shows a list that fits the page whole, with no hint', () => {
    expect(pageScroller().paginate('a\nb\nc', 2, 5)).toBe('a\nb\nc');
  });

  it('starts at the top of a longer list and says there are more', () => {
    expect(walk(0)[0]).toEqual(['a', 'b', 'c', 'd', 'e', HINT]);
  });

  it('keeps the page still while the arrow moves down to its last row', () => {
    expect(walk(0, 1, 2, 3, 4)[4]).toEqual(['a', 'b', 'c', 'd', 'e', HINT]);
  });

  it('scrolls one row at a time once the arrow is on the last row, keeping it there', () => {
    const pages = walk(0, 1, 2, 3, 4, 5, 6);

    expect(pages[5]).toEqual(['b', 'c', 'd', 'e', 'f', HINT]);
    expect(pages[6]).toEqual(['c', 'd', 'e', 'f', 'g', HINT]);
  });

  it('ends at the last choice and never shows the first one again after it', () => {
    expect(walk(0, 1, 2, 3, 4, 5, 6, 7, 7)[8]).toEqual(['d', 'e', 'f', 'g', 'h', HINT]);
  });

  it('keeps the page still while the arrow moves back up, and scrolls once it goes above the top row', () => {
    const pages = walk(7, 6, 5, 4, 3, 2);

    expect(pages[4]).toEqual(['d', 'e', 'f', 'g', 'h', HINT]);
    expect(pages[5]).toEqual(['c', 'd', 'e', 'f', 'g', HINT]);
  });

  it('opens on the page that holds a choice offered further down, with it on the last row', () => {
    expect(walk(6)[0]).toEqual(['c', 'd', 'e', 'f', 'g', HINT]);
  });
});

describe('launchPaginated', () => {
  interface Paginated {
    paginator: { paginate(output: string, active: number, pageSize?: number): string };
  }

  class Upstream {
    paginator = { paginate: (output: string) => output };
  }

  it('pages with its own scroller, which keeps the arrow moving and says how to see more', () => {
    const Prompt = launchPaginated(Upstream as never) as unknown as new () => Paginated;
    const prompt = new Prompt();
    const lines = Array.from({ length: 10 }, (_, index) => `c${index}`).join('\n');

    expect(prompt.paginator.paginate(lines, 3, 7).split('\n')).toEqual([
      'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', `\u001b[2m${MORE_CHOICES_HINT}\u001b[22m`,
    ]);
    expect(MORE_CHOICES_HINT).toBe('(Use ↑/↓ to see more options)');
  });

  it('gives each prompt a scroller of its own', () => {
    const Prompt = launchPaginated(Upstream as never) as unknown as new () => Paginated;

    expect(new Prompt().paginator).not.toBe(new Prompt().paginator);
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

    expect(loaded).toEqual(['inquirer', 'inquirer-search-list', 'inquirer/lib/prompts/list', 'inquirer/lib/prompts/checkbox']);
    expect(registered.map(([name]) => name)).toEqual(['search-list', 'list', 'checkbox']);
    expect(registered[0][0]).toBe('search-list');
    expect((registered[0][1] as SearchListClass).prototype).toBeInstanceOf(SearchList);
    expect(registered[0][1]).not.toBe(SearchList);
  });

  it('registers on the real inquirer cli-utilities depends on when no loader is given', () => {
    const inquirer = load('inquirer') as { prompt: { prompts: Record<string, unknown> } };

    registerSearchList();

    expect((inquirer.prompt.prompts['search-list'] as SearchListClass).prototype).toBeInstanceOf(SearchList);
    for (const type of ['list', 'checkbox']) {
      const Upstream = load(`inquirer/lib/prompts/${type}`) as SearchListClass;

      expect((inquirer.prompt.prompts[type] as SearchListClass).prototype).toBeInstanceOf(Upstream);
      expect(inquirer.prompt.prompts[type]).not.toBe(Upstream);
    }
  });
});
