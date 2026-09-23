import { UsageError } from './errors';
import { atLeastOneOf, exactlyOneOf, onlyWithValueOf } from './rules';

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

describe('atLeastOneOf', () => {
  it('passes when one of the named inputs has a value', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: undefined })).not.toThrow();
  });

  it('passes when every named input has a value', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: 5 })).not.toThrow();
  });

  it('fails naming every flag when none of them has a value', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({})).toThrow(UsageError);
    expect(() => rule({})).toThrow('Pass at least one of --limit, --skip; none was supplied.');
  });

  it.each([[null], [undefined], [false]])('does not count %p as a supplied value', (value) => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({ limit: value, skip: value })).toThrow('Pass at least one of --limit, --skip; none was supplied.');
  });

  it.each([[0], ['']])('counts the falsy-but-present value %p as supplied', (value) => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({ limit: value })).not.toThrow();
  });
});

describe('onlyWithValueOf', () => {
  const SUPPORTED = ['ANALOG', 'ANGULAR', 'NUXT', 'ASTRO', 'REMIX', 'OTHER'];

  it('passes when the gated flag was not supplied at all, whatever the gate says', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule({ framework: 'NEXTJS' })).not.toThrow();
    expect(() => rule({})).not.toThrow();
  });

  it('passes when the gate value is one the rule allows', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    for (const framework of SUPPORTED) {
      expect(() => rule({ 'server-cmd': 'npm start', framework })).not.toThrow();
    }
  });

  it('fails naming every supported value and the value it actually found', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule({ 'server-cmd': 'npm start', framework: 'NEXTJS' })).toThrow(UsageError);
    expect(() => rule({ 'server-cmd': 'npm start', framework: 'NEXTJS' })).toThrow(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is NEXTJS.',
    );
  });

  it('fails saying the gate was not supplied when there is no gate value to report', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);
    const expected =
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
      '--framework was not supplied.';

    expect(() => rule({ 'server-cmd': 'npm start' })).toThrow(expected);
    expect(() => rule({ 'server-cmd': 'npm start', framework: undefined })).toThrow(expected);
    expect(() => rule({ 'server-cmd': 'npm start', framework: null })).toThrow(expected);
    expect(() => rule({ 'server-cmd': 'npm start', framework: '' })).toThrow(expected);
    expect(() => rule({ 'server-cmd': 'npm start', framework: 7 })).toThrow(expected);
  });

  it.each([[null], [undefined], [false]])('does not gate on %p as a supplied gated value', (value) => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule({ 'server-cmd': value, framework: 'NEXTJS' })).not.toThrow();
  });

  it('gates on the falsy-but-present empty string, which the API would still receive', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule({ 'server-cmd': '', framework: 'NEXTJS' })).toThrow(UsageError);
  });
});
