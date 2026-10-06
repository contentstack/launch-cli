import { CancelledError } from './errors';
import { askOption, askText } from './prompt';
import type { UxLike } from './prompt';

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
    });
  });

  it('cancels rather than accepting nothing at a list of options', async () => {
    const { ux } = scriptedUx([undefined]);

    await expect(askOption(ux, 'Project type', [{ name: 'a', value: 'a' }])).rejects.toThrow(CancelledError);
  });
});
