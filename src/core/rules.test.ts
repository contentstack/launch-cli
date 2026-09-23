import { UsageError } from './errors';
import { exactlyOneOf } from './rules';

describe('exactlyOneOf', () => {
  it('passes when exactly one of the named inputs has a value', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: undefined })).not.toThrow();
  });

  it('fails naming every flag when none of them has a value', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({})).toThrow(UsageError);
    expect(() => rule({})).toThrow('Pass exactly one of --limit, --skip; none was supplied.');
  });

  it('fails naming the supplied flags when more than one has a value', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: 5 })).toThrow(UsageError);
    expect(() => rule({ limit: 10, skip: 5 })).toThrow('Pass exactly one of --limit, --skip; --limit, --skip were supplied.');
  });

  it.each([[null], [undefined], [false]])('does not count %p as a supplied value', (value) => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: value })).not.toThrow();
  });

  it('counts a boolean flag sitting at its false default as not supplied', () => {
    const rule = exactlyOneOf('yes', 'limit');

    expect(() => rule({ yes: false, limit: undefined })).toThrow('Pass exactly one of --yes, --limit; none was supplied.');
    expect(() => rule({ yes: true, limit: undefined })).not.toThrow();
  });

  it.each([[0], ['']])('counts the falsy-but-present value %p as supplied', (value) => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({ limit: value })).not.toThrow();
    expect(() => rule({ limit: value, skip: 5 })).toThrow('--limit, --skip were supplied.');
  });
});
