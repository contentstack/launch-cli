import { parseDotenv } from './variable.dotenv';

describe('variable dotenv', () => {
  it('reads each KEY=VALUE line in order, ignoring comments and blank lines', () => {
    const parsed = parseDotenv('# comment\nA=1\n\nB=two words\nC="quoted value"\n');

    expect(parsed).toEqual({
      variables: [
        { key: 'A', value: '1' },
        { key: 'B', value: 'two words' },
        { key: 'C', value: 'quoted value' },
      ],
      skipped: [],
    });
  });

  it('keeps an equals sign inside a value', () => {
    expect(parseDotenv('TOKEN=a=b').variables).toEqual([{ key: 'TOKEN', value: 'a=b' }]);
  });

  it('skips a variable with an empty value and names its key instead of its value', () => {
    const parsed = parseDotenv('A=1\nEMPTY=\nBLANK=   \nB=2');

    expect(parsed.variables).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
    expect(parsed.skipped).toEqual(['EMPTY', 'BLANK']);
  });

  it('takes the last occurrence of a repeated key', () => {
    expect(parseDotenv('A=1\nA=2').variables).toEqual([{ key: 'A', value: '2' }]);
  });

  it.each([[''], ['   \n'], ['# only a comment']])('returns nothing for text with no variables (%p)', (text) => {
    expect(parseDotenv(text)).toEqual({ variables: [], skipped: [] });
  });

  it('reads a Buffer the way it reads text', () => {
    expect(parseDotenv(Buffer.from('A=1')).variables).toEqual([{ key: 'A', value: '1' }]);
  });
});
