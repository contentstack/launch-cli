import { UsageError } from './errors';
import { oneOf, withinLength } from './values';

describe('input value helpers', () => {
  it('returns a value at or under the limit unchanged', async () => {
    await expect(withinLength('name', 'abc', 3)).resolves.toBe('abc');
    await expect(withinLength('name', '', 3)).resolves.toBe('');
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
