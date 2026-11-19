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

  it.each([
    ['COLOR', '#ff0000'],
    ['URL', 'https://x.test/#/home'],
    ['PW', 'p@ss#word1'],
  ])('keeps a # with no space or tab before it in an unquoted value (%s)', (key, value) => {
    expect(parseDotenv(`${key}=${value}`).variables).toEqual([{ key, value }]);
  });

  it.each([['A=value #123'], ['A=value\t#123'], ['A=value   # note']])(
    'drops a comment that starts with # after a space or tab (%p)',
    (line) => {
      expect(parseDotenv(line).variables).toEqual([{ key: 'A', value: 'value' }]);
    },
  );

  it('drops a leading export followed by a space or tab, but not export joined to the key', () => {
    expect(parseDotenv('export API_URL=https://x\nexport\tB=1\nexportC=2').variables).toEqual([
      { key: 'API_URL', value: 'https://x' },
      { key: 'B', value: '1' },
      { key: 'exportC', value: '2' },
    ]);
  });

  it('keeps an equals sign inside a value', () => {
    expect(parseDotenv('TOKEN=a=b').variables).toEqual([{ key: 'TOKEN', value: 'a=b' }]);
  });

  it('skips a variable with an empty value and names its key instead of its value', () => {
    const parsed = parseDotenv('A=1\nEMPTY=\nBLANK=   \nNOTE= #note\nB=2');

    expect(parsed.variables).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
    expect(parsed.skipped).toEqual(['EMPTY', 'BLANK', 'NOTE']);
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
