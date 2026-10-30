import { UsageError } from './errors';
import { asSentence, isRecord, messageOf, oneOf, withinLength, withoutControlCharacters } from './values';

describe('input value helpers', () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    [undefined, false],
    ['', false],
    [0, false],
    [false, false],
  ])('treats %p as a record: %p', (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });

  it.each([
    [new Error('the socket closed'), 'the socket closed'],
    ['a thrown string', 'a thrown string'],
    [404, '404'],
  ])('reads the message out of the thrown value %p', (thrown, message) => {
    expect(messageOf(thrown)).toBe(message);
  });

  it.each([
    ['The repository is private', 'The repository is private.'],
    ['  The repository is private.  ', 'The repository is private.'],
  ])('ends %j as one sentence with a single full stop', (text, sentence) => {
    expect(asSentence(text)).toBe(sentence);
  });

  it('returns a value at or under the limit unchanged', async () => {
    await expect(withinLength('name', 'abc', 3)).resolves.toBe('abc');
    await expect(withinLength('name', '', 3)).resolves.toBe('');
  });

  it('drops the spaces around a value, and counts its length without them', async () => {
    await expect(withinLength('name', '  my-site  ', 200)).resolves.toBe('my-site');
    await expect(withinLength('name', '  abc  ', 3)).resolves.toBe('abc');
  });

  it('refuses a value over the limit with a usage error naming the flag and both lengths', async () => {
    await expect(withinLength('name', 'abcd', 3)).rejects.toThrow(UsageError);
    await expect(withinLength('name', 'abcd', 3)).rejects.toThrow(
      '--name must be 3 characters or fewer; that value is 4 characters.',
    );
  });

  it('returns the canonical option however the value was cased or padded', () => {
    expect(oneOf('res-mode', 'buffered', ['buffered', 'streaming'])).toBe('buffered');
    expect(oneOf('res-mode', ' STREAMING ', ['buffered', 'streaming'])).toBe('streaming');
  });

  it('refuses a value outside the option set, listing every option it would accept', () => {
    expect(() => oneOf('res-mode', 'chunked', ['buffered', 'streaming'])).toThrow(UsageError);
    expect(() => oneOf('res-mode', 'chunked', ['buffered', 'streaming'])).toThrow(
      '--res-mode must be one of buffered, streaming; "chunked" is not.',
    );
  });

  it('refuses an empty or whitespace-only value rather than matching nothing quietly', () => {
    expect(() => oneOf('res-mode', '   ', ['buffered', 'streaming'])).toThrow(
      '--res-mode must be one of buffered, streaming; "   " is not.',
    );
  });
});

describe('withoutControlCharacters', () => {
  it.each([
    ['a line feed', 'a\nb', 'a b'],
    ['a run of line breaks and a carriage return', 'a\r\n\n\nb', 'a b'],
    ['a tab', 'a\tb', 'a b'],
    ['a bell', 'a\u0007b', 'a b'],
    ['a delete', 'a\u007fb', 'a b'],
    ['a C1 control', 'a\u0085b', 'a b'],
    ['a colour escape sequence', 'a\u001b[31mb\u001b[39m', 'ab'],
    ['the last C0 control and the first C1 neighbour', 'a\u001fb\u00a0c', 'a b\u00a0c'],
    ['no control character', 'plain text \u2026 \u{1f600}', 'plain text \u2026 \u{1f600}'],
    ['an empty string', '', ''],
  ])('replaces %s with one space', (_label, value, expected) => {
    expect(withoutControlCharacters(value)).toBe(expected);
  });

  it('leaves the printable boundaries either side of the C0 and C1 ranges alone', () => {
    expect(withoutControlCharacters('a b~\u00a0')).toBe('a b~\u00a0');
    expect(withoutControlCharacters('\u001f')).toBe(' ');
    expect(withoutControlCharacters('\u0020')).toBe(' ');
    expect(withoutControlCharacters('\u007e')).toBe('~');
    expect(withoutControlCharacters('\u009f')).toBe(' ');
    expect(withoutControlCharacters('\u00a0')).toBe('\u00a0');
  });
});
