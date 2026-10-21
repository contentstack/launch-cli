import { UsageError } from '../core/errors';
import { parseAssignment, splitLine } from './variable.parse';

describe('variable parse', () => {
  it('splits KEY=VALUE into a key and a value', () => {
    expect(parseAssignment('API_URL=https://example.test')).toEqual({ key: 'API_URL', value: 'https://example.test' });
  });

  it('splits on the first equals sign so a value may contain one', () => {
    expect(parseAssignment('TOKEN=a=b')).toEqual({ key: 'TOKEN', value: 'a=b' });
  });

  it('keeps a value with spaces whole', () => {
    expect(parseAssignment('MSG=hello world')).toEqual({ key: 'MSG', value: 'hello world' });
  });

  it('reads a bare key as a key with no value yet', () => {
    expect(parseAssignment('API_KEY')).toEqual({ key: 'API_KEY', value: undefined });
  });

  it('accepts a colon as the separator only when no equals sign is present', () => {
    expect(parseAssignment('API_URL:value')).toEqual({ key: 'API_URL', value: 'value' });
    expect(parseAssignment('API_URL=https://x.test:8080')).toEqual({ key: 'API_URL', value: 'https://x.test:8080' });
  });

  it('trims the key but not the value', () => {
    expect(parseAssignment('  KEY  =  spaced  ')).toEqual({ key: 'KEY', value: '  spaced  ' });
  });

  it.each([[''], ['   '], ['=value'], ['  =value'], [':value']])('rejects a token with no key (%p)', (token) => {
    expect(() => parseAssignment(token)).toThrow(UsageError);
    expect(() => parseAssignment(token)).toThrow('A variable needs a key before its value.');
  });

  it.each([['KEY='], ['KEY=  '], ['KEY:']])('rejects an empty value and names the key (%p)', (token) => {
    expect(() => parseAssignment(token)).toThrow(UsageError);
    expect(() => parseAssignment(token)).toThrow('KEY has an empty value. The Launch API does not accept one.');
  });
});

describe('variable parse split line', () => {
  it('splits on whitespace', () => {
    expect(splitLine('A=1 B=2   C=3')).toEqual(['A=1', 'B=2', 'C=3']);
  });

  it('keeps a double-quoted or single-quoted stretch together and drops the quotes', () => {
    expect(splitLine('MSG="hello world" NOTE=\'a b\'')).toEqual(['MSG=hello world', 'NOTE=a b']);
  });

  it('joins a quoted stretch to the text beside it', () => {
    expect(splitLine('A="x y"z')).toEqual(['A=x yz']);
  });

  it('keeps the other kind of quote literal inside a quoted stretch', () => {
    expect(splitLine('A="it\'s" B=\'say "hi"\'')).toEqual(['A=it\'s', 'B=say "hi"']);
  });

  it('keeps an empty quoted value as an empty token', () => {
    expect(splitLine('A="" B=2')).toEqual(['A=', 'B=2']);
  });

  it('keeps a backslash outside quotes as a literal character', () => {
    expect(splitLine('DIR=C:\\Users\\me A=x\\ y')).toEqual(['DIR=C:\\Users\\me', 'A=x\\', 'y']);
  });

  it('starts a token with a quoted stretch', () => {
    expect(splitLine('"a b" c')).toEqual(['a b', 'c']);
  });

  it('keeps a trailing backslash as a literal character', () => {
    expect(splitLine('A=x\\')).toEqual(['A=x\\']);
  });

  it.each([[''], ['   ']])('returns nothing for a line with no tokens (%p)', (line) => {
    expect(splitLine(line)).toEqual([]);
  });

  it.each([['A="unterminated'], ["A='unterminated"]])('refuses an unterminated quote (%p) without echoing the text', (line) => {
    expect(() => splitLine(line)).toThrow(UsageError);
    expect(() => splitLine(line)).toThrow('The line has an opening quote with no closing quote.');
  });
});
