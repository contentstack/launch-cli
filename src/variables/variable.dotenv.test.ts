import { DotenvLineError, parseDotenv } from './variable.dotenv';

function lineErrorOf(text: string): DotenvLineError {
  try {
    parseDotenv(text);
  } catch (error) {
    return error as DotenvLineError;
  }

  throw new Error('parseDotenv did not throw');
}

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

  it.each([['A=1\r\nB=2\r\n'], ['A=1\rB=2']])('reads Windows and old Mac line endings (%p)', (text) => {
    expect(parseDotenv(text).variables).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
  });

  it('accepts a key with dots, dashes and digits after its first character', () => {
    expect(parseDotenv('_a.b-c9=1').variables).toEqual([{ key: '_a.b-c9', value: '1' }]);
  });

  it('trims spaces around the key and the value', () => {
    expect(parseDotenv('  KEY = abc   ').variables).toEqual([{ key: 'KEY', value: 'abc' }]);
  });

  it.each([
    ['A="p@ss #1"', 'p@ss #1'],
    ["A='a b'", 'a b'],
    ['A="v" #123', 'v'],
    ["A='v'\t# note", 'v'],
    ['A=`x y`', 'x y'],
    ['A="a\\"b"', 'a\\"b'],
    ['A="C:\\temp\\"', 'C:\\temp\\'],
    ["A='C:\\temp\\'", 'C:\\temp\\'],
    ['A="{"a":1}"', '{"a":1}'],
    ["A='it's here'", "it's here"],
    ['A="{"a":1}" # c', '{"a":1}'],
  ])('removes the quotes around a quoted value and keeps a # inside them (%p)', (line, value) => {
    expect(parseDotenv(line).variables).toEqual([{ key: 'A', value }]);
  });

  it('turns \\n and \\r into line breaks inside double quotes only', () => {
    expect(parseDotenv('A="a\\nb\\rc"\nB=\'a\\nb\'\nC=a\\nb').variables).toEqual([
      { key: 'A', value: 'a\nb\rc' },
      { key: 'B', value: 'a\\nb' },
      { key: 'C', value: 'a\\nb' },
    ]);
  });

  it('ends a value at a quote at the end of its own line before looking at later lines', () => {
    expect(parseDotenv('DIR="C:\\temp\\"\nB="x"').variables).toEqual([
      { key: 'DIR', value: 'C:\\temp\\' },
      { key: 'B', value: 'x' },
    ]);
  });

  it('reads a quoted value that spans several lines', () => {
    expect(parseDotenv('KEY="-----BEGIN KEY-----\nabc=\ndef==\n-----END KEY-----"\nB=2').variables).toEqual([
      { key: 'KEY', value: '-----BEGIN KEY-----\nabc=\ndef==\n-----END KEY-----' },
      { key: 'B', value: '2' },
    ]);
  });

  it.each([
    ['A=1\n\nAPI_URL https://x', 3, 'has no "="'],
    ['A=1\n = abc', 2, 'has no key before "="'],
    ['1A=x', 1, 'has an invalid key before "="'],
    ['MY KEY=1', 1, 'has an invalid key before "="'],
    ['q8Xz+/AbCd==', 1, 'has an invalid key before "="'],
    ['PASS="abc\nB=2', 1, 'opens a quote for PASS that is never closed'],
    ['PASS="abc\nB="x"y', 1, 'opens a quote for PASS that closes on line 2 with text after it'],
    ['A="multi\nline" trailing', 1, 'opens a quote for A that closes on line 2 with text after it'],
    ['A=1\nKEY="v"x', 2, 'has text after the closing quote of KEY'],
    ['A=1\nB=2\nA=3', 3, 'repeats the key A'],
  ])('refuses a malformed line, naming its line number (%p)', (text, line, problem) => {
    const error = lineErrorOf(text);

    expect(error).toBeInstanceOf(DotenvLineError);
    expect(error.line).toBe(line);
    expect(error.problem).toBe(problem);
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

  it.each([[''], ['   \n'], ['# only a comment']])('returns nothing for text with no variables (%p)', (text) => {
    expect(parseDotenv(text)).toEqual({ variables: [], skipped: [] });
  });

  it('reads a Buffer the way it reads text', () => {
    expect(parseDotenv(Buffer.from('A=1')).variables).toEqual([{ key: 'A', value: '1' }]);
  });
});
