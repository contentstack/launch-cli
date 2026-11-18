import { promptLibrary } from './search-list';
import { libraryUx, terminalUx } from './terminal-ux';

const QUESTION = { type: 'list', name: 'value', message: 'Choose an environment', choices: ['Default'] };

describe('libraryUx', () => {
  it('asks the question through the prompt library and resolves with the answer to the named question', async () => {
    const asked: unknown[] = [];
    const library = {
      prompt: async (question: unknown) => {
        asked.push(question);
        return { value: 'Default' };
      },
    };

    const answer = await libraryUx(() => library, noPrinting).inquire<string>(QUESTION);

    expect(answer).toBe('Default');
    expect(asked).toEqual([QUESTION]);
  });

  it('prints through the printer it was given', () => {
    const printed: string[] = [];

    libraryUx(unusedLibrary, (message) => printed.push(message)).print('Using the organization Acme.');

    expect(printed).toEqual(['Using the organization Acme.']);
  });
});

describe('terminalUx', () => {
  it('asks through the inquirer cli-utilities ships, the one search-list is registered with', async () => {
    const prompt = jest.spyOn(promptLibrary(), 'prompt').mockResolvedValue({ value: 'Default' });

    const answer = await terminalUx.inquire<string>(QUESTION);

    expect(answer).toBe('Default');
    expect(prompt).toHaveBeenCalledWith(QUESTION);
  });
});

function noPrinting(): void {
  return undefined;
}

function unusedLibrary(): never {
  throw new Error('printing must not reach the prompt library');
}
