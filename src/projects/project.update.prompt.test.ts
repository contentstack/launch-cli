import { UxLike } from '../core/render';
import { askFieldValue, checkFieldValue, promptForProjectUpdate } from './project.update.prompt';

function scriptedUx(answers: unknown[]) {
  const asked: Record<string, unknown>[] = [];
  let index = 0;
  const ux: UxLike = {
    print: () => undefined,
    inquire: async (payload: unknown) => {
      asked.push(payload as Record<string, unknown>);
      const answer = answers[index];
      index += 1;
      return answer as never;
    },
  };

  return { ux, asked };
}

const CURRENT = { uid: 'p1', name: 'test', description: 'old blurb' };

describe('project update prompts', () => {
  it('asks for the name then the description, with no pre-filled value', async () => {
    const { ux, asked } = scriptedUx(['', '']);

    await promptForProjectUpdate(ux, CURRENT);

    expect(asked).toEqual([
      expect.objectContaining({ type: 'input', message: 'Update project name (optional)' }),
      expect.objectContaining({ type: 'input', message: 'Update project description (optional)' }),
    ]);
    expect(asked.every((question) => !('default' in question))).toBe(true);
  });

  it('sends only the name when only the name was typed', async () => {
    const { ux } = scriptedUx(['test-renamed', '']);

    await expect(promptForProjectUpdate(ux, CURRENT)).resolves.toEqual({ name: 'test-renamed' });
  });

  it('sends only the description when only the description was typed', async () => {
    const { ux } = scriptedUx(['', 'Marketing site for Q4']);

    await expect(promptForProjectUpdate(ux, CURRENT)).resolves.toEqual({ description: 'Marketing site for Q4' });
  });

  it('sends both fields when both were typed', async () => {
    const { ux } = scriptedUx(['test-renamed', 'Marketing site for Q4']);

    await expect(promptForProjectUpdate(ux, CURRENT)).resolves.toEqual({
      name: 'test-renamed',
      description: 'Marketing site for Q4',
    });
  });

  it('sends nothing when both prompts were left blank', async () => {
    const { ux } = scriptedUx(['', '']);

    await expect(promptForProjectUpdate(ux, CURRENT)).resolves.toEqual({});
  });

  it('leaves out a value that matches the current one', async () => {
    const { ux } = scriptedUx(['test', 'Marketing site for Q4']);

    await expect(promptForProjectUpdate(ux, CURRENT)).resolves.toEqual({ description: 'Marketing site for Q4' });
  });

  it('asks only for the fields it was given', async () => {
    const { ux, asked } = scriptedUx(['Marketing site for Q4']);

    await expect(promptForProjectUpdate(ux, CURRENT, ['description'])).resolves.toEqual({
      description: 'Marketing site for Q4',
    });
    expect(asked).toEqual([expect.objectContaining({ message: 'Update project description (optional)' })]);
  });

  it('trims what was typed and treats whitespace alone as blank', async () => {
    const { ux } = scriptedUx(['  test-renamed  ', '   ']);

    await expect(promptForProjectUpdate(ux, CURRENT)).resolves.toEqual({ name: 'test-renamed' });
  });

  it('treats an answer that is not text as blank', async () => {
    const { ux } = scriptedUx([undefined]);

    await expect(askFieldValue(ux, 'name')).resolves.toBe('');
  });

  it('validates the length inside the prompt so the user can retry', async () => {
    const { ux, asked } = scriptedUx(['ok']);

    await askFieldValue(ux, 'name');
    const validate = asked[0].validate as (value: string) => true | string;

    expect(validate('n'.repeat(201))).toBe('Name must be 200 characters or fewer; that value is 201 characters.');
    expect(validate('')).toBe(true);
  });

  it('accepts values up to each field limit and rejects one character more', () => {
    expect(checkFieldValue('name', 'n'.repeat(200))).toBe(true);
    expect(checkFieldValue('description', 'd'.repeat(255))).toBe(true);
    expect(checkFieldValue('description', 'd'.repeat(256))).toBe(
      'Description must be 255 characters or fewer; that value is 256 characters.',
    );
  });
});
