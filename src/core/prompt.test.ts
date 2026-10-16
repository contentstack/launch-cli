import { CancelledError, MissingInputError } from './errors';
import { PROMPT_PAGE_SIZE, askChoices, askOption, askSecret, askText, needInput } from './prompt';
import type { UxLike } from './prompt';
import type { ServiceContext } from './service-context';

function scriptedUx(answers: unknown[]) {
  const asked: unknown[] = [];
  let index = 0;

  const ux: UxLike = {
    print: () => undefined,
    inquire: async (payload: unknown) => {
      asked.push(payload);
      const answer = answers[index];
      index += 1;
      return answer as never;
    },
  };

  return { ux, asked };
}

describe('prompt helpers', () => {
  it('asks for free text and returns what was typed', async () => {
    const { asked, ux } = scriptedUx(['My Site']);

    await expect(askText(ux, 'Project name', 'suggested')).resolves.toBe('My Site');
    expect(asked).toEqual([
      { type: 'input', name: 'value', message: 'Project name', default: 'suggested', validate: expect.any(Function) },
    ]);
  });

  it('returns the answer without the spaces typed around it', async () => {
    const { ux } = scriptedUx(['  My Site  ']);

    await expect(askText(ux, 'Project name')).resolves.toBe('My Site');
  });

  it('refuses a blank answer at the prompt, so it is asked again rather than sent', async () => {
    const { asked, ux } = scriptedUx(['My Site']);

    await askText(ux, 'Project name');
    const { validate } = asked[0] as { validate: (value: string) => true | string };

    expect(validate('   ')).toBe('Project name can\'t be empty.');
  });

  it('lets real text through the prompt, and still holds it to the length limit when there is one', async () => {
    const { asked, ux } = scriptedUx(['abc', 'abc']);

    await askText(ux, 'Project name');
    await askText(ux, 'Project name', undefined, 3);
    const [unlimited, limited] = asked.map((payload) => (payload as { validate: (value: string) => true | string }).validate);

    expect(unlimited('My Site')).toBe(true);
    expect(limited('abc')).toBe(true);
    expect(limited('abcd')).toBe('Project name must be 3 characters or fewer; that value is 4 characters.');
  });

  it('cancels rather than accepting nothing at a text prompt', async () => {
    for (const answer of [undefined, null, '']) {
      const { ux } = scriptedUx([answer]);

      await expect(askText(ux, 'Project name')).rejects.toThrow(CancelledError);
    }
  });

  it('asks a fixed set of options as a list, which takes no typed text, and returns the one picked', async () => {
    const { asked, ux } = scriptedUx(['FileUpload']);
    const choices = [
      { name: 'GitHub', value: 'GitHub' },
      { name: 'FileUpload', value: 'FileUpload' },
    ];

    await expect(askOption(ux, 'Project type', choices, 'GitHub')).resolves.toBe('FileUpload');
    expect(asked[0]).toEqual({
      type: 'list',
      name: 'value',
      message: 'Project type',
      choices,
      default: 'GitHub',
      loop: false,
      pageSize: 2,
    });
  });

  it.each([
    [3, 3],
    [15, 15],
    [16, 15],
    [100, 15],
  ])('shows %i choices %i rows at a time, so a short list is shown whole and a long one scrolls', async (count, rows) => {
    const { asked, ux } = scriptedUx(['c0']);
    const choices = Array.from({ length: count }, (_, index) => ({ name: `C${index}`, value: `c${index}` }));

    await askOption(ux, 'Pick one', choices);

    expect((asked[0] as { pageSize: number }).pageSize).toBe(rows);
    expect(PROMPT_PAGE_SIZE).toBe(15);
  });

  it('cancels rather than accepting nothing at a list of options', async () => {
    const { ux } = scriptedUx([undefined]);

    await expect(askOption(ux, 'Project type', [{ name: 'a', value: 'a' }])).rejects.toThrow(CancelledError);
  });
});

describe('askSecret', () => {
  it('asks with a masked password prompt and returns exactly what was typed, spaces included', async () => {
    const { asked, ux } = scriptedUx([' s3cret ']);

    await expect(askSecret(ux, 'Password')).resolves.toBe(' s3cret ');
    expect(asked).toEqual([
      { type: 'password', name: 'value', message: 'Password', mask: '*', validate: expect.any(Function) },
    ]);
  });

  it('refuses a blank answer at the prompt without echoing anything typed', async () => {
    const { asked, ux } = scriptedUx(['s3cret']);

    await askSecret(ux, 'Password');
    const validate = (asked[0] as { validate(value: string): true | string }).validate;

    expect(validate('   ')).toBe("Password can't be empty.");
    expect(validate('')).toBe("Password can't be empty.");
    expect(validate('x')).toBe(true);
  });

  it('cancels when the prompt is dismissed without an answer', async () => {
    const { ux } = scriptedUx([undefined]);

    await expect(askSecret(ux, 'Password')).rejects.toBeInstanceOf(CancelledError);
  });
});

const ON_TERMINAL = { isTTY: true } as ServiceContext;
const OFF_TERMINAL = { isTTY: false } as ServiceContext;

describe('needInput', () => {
  it('returns the supplied value without asking, terminal or not', async () => {
    const ask = jest.fn(async () => 'asked');

    await expect(needInput(ON_TERMINAL, 'name', 'given', ask)).resolves.toBe('given');
    await expect(needInput(OFF_TERMINAL, 'name', 'given', ask)).resolves.toBe('given');
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks on a terminal when nothing was supplied', async () => {
    await expect(needInput(ON_TERMINAL, 'name', undefined, async () => 'asked')).resolves.toBe('asked');
  });

  it('refuses with a missing-input error naming only the terminal remedy when nothing was supplied off a terminal', async () => {
    const ask = jest.fn(async () => 'asked');

    const failure = await needInput(OFF_TERMINAL, 'name', undefined, ask).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MissingInputError);
    expect(failure).toEqual(new MissingInputError('name', { config: false, prompt: true }));
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('askChoices', () => {
  it('asks with a checkbox prompt and returns the values ticked', async () => {
    const { asked, ux } = scriptedUx([['b', 'c']]);
    const choices = [
      { name: 'A', value: 'a' },
      { name: 'B', value: 'b' },
      { name: 'C', value: 'c' },
    ];

    await expect(askChoices(ux, 'Which ones?', choices)).resolves.toEqual(['b', 'c']);
    expect(asked).toEqual([
      {
        type: 'checkbox',
        name: 'value',
        message: 'Which ones?',
        choices,
        loop: false,
        pageSize: 3,
        validate: expect.any(Function),
      },
    ]);
  });

  it('refuses to go on with nothing ticked, saying how to tick, and accepts any ticked answer', async () => {
    const { asked, ux } = scriptedUx([['a']]);

    await askChoices(ux, 'Which ones?', [{ name: 'A', value: 'a' }]);
    const validate = (asked[0] as { validate(value: unknown): true | string }).validate;

    expect(validate([])).toBe('Select at least one with <space>, then press <enter>.');
    expect(validate(undefined)).toBe('Select at least one with <space>, then press <enter>.');
    expect(validate(['a'])).toBe(true);
  });

  it.each([[[]], [undefined], ['b']])('answers no choice at all when the prompt returns %p', async (answer) => {
    const { ux } = scriptedUx([answer]);

    await expect(askChoices(ux, 'Which ones?', [{ name: 'B', value: 'b' }])).resolves.toEqual([]);
  });
});
