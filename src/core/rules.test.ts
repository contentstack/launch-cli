import { UsageError } from './errors';
import type { InputSource } from './resolution';
import { InputSources, ResolvedValues, atLeastOneOf, exactlyOneOf, onlyWithValueOf } from './rules';

function from(source: InputSource, values: ResolvedValues): InputSources {
  return Object.fromEntries(Object.keys(values).map((key) => [key, source]));
}

function typed(values: ResolvedValues): [ResolvedValues, InputSources] {
  return [values, from('flag', values)];
}

describe('exactlyOneOf', () => {
  it('passes when exactly one of the named inputs was supplied', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: undefined }, { limit: 'flag' })).not.toThrow();
  });

  it('fails naming every flag when none of them was supplied', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({}, {})).toThrow(UsageError);
    expect(() => rule({}, {})).toThrow('Pass exactly one of --limit, --skip; none was supplied.');
  });

  it('fails naming the supplied flags when more than one was supplied', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule(...typed({ limit: 10, skip: 5 }))).toThrow(UsageError);
    expect(() => rule(...typed({ limit: 10, skip: 5 }))).toThrow(
      'Pass exactly one of --limit, --skip; --limit, --skip were supplied.',
    );
  });

  it('counts a value from the flag, the config file or a prompt as supplied, and one from a default as not', () => {
    const rule = exactlyOneOf('limit', 'skip');

    for (const source of ['flag', 'config', 'prompt'] as const) {
      expect(() => rule({ limit: 10, skip: 0 }, { limit: 'flag', skip: source })).toThrow(
        '--limit, --skip were supplied.',
      );
    }

    expect(() => rule({ limit: 10, skip: 0 }, { limit: 'flag', skip: 'default' })).not.toThrow();
  });

  it('does not count a value that carries no source as supplied', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: 5 }, { limit: 'flag' })).not.toThrow();
  });

  it.each([[null], [undefined], [false], [''], ['   ']])('does not count %p as a supplied value', (value) => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule(...typed({ limit: 10, skip: value }))).not.toThrow();
  });

  it('counts a boolean flag sitting at false as not supplied and one set true as supplied', () => {
    const rule = exactlyOneOf('yes', 'limit');

    expect(() => rule(...typed({ yes: false, limit: undefined }))).toThrow(
      'Pass exactly one of --yes, --limit; none was supplied.',
    );
    expect(() => rule(...typed({ yes: true, limit: undefined }))).not.toThrow();
  });

  it('counts a numeric zero the user supplied as supplied', () => {
    const rule = exactlyOneOf('limit', 'skip');

    expect(() => rule(...typed({ limit: 0 }))).not.toThrow();
    expect(() => rule(...typed({ limit: 0, skip: 5 }))).toThrow('--limit, --skip were supplied.');
  });
});

describe('atLeastOneOf', () => {
  it('passes when one of the named inputs was supplied', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({ limit: 10, skip: undefined }, { limit: 'flag' })).not.toThrow();
  });

  it('passes when every named input was supplied', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule(...typed({ limit: 10, skip: 5 }))).not.toThrow();
  });

  it('fails naming every flag when none of them was supplied', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({}, {})).toThrow(UsageError);
    expect(() => rule({}, {})).toThrow('Pass at least one of --limit, --skip; none was supplied.');
  });

  it('fails when the only values present were filled in by their defaults', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule({ limit: 100, skip: 0 }, from('default', { limit: 100, skip: 0 }))).toThrow(
      'Pass at least one of --limit, --skip; none was supplied.',
    );
  });

  it.each([[null], [undefined], [false], [''], ['   ']])('does not count %p as a supplied value', (value) => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule(...typed({ limit: value, skip: value }))).toThrow(
      'Pass at least one of --limit, --skip; none was supplied.',
    );
  });

  it('counts a numeric zero the user supplied as supplied', () => {
    const rule = atLeastOneOf('limit', 'skip');

    expect(() => rule(...typed({ limit: 0 }))).not.toThrow();
  });
});

describe('onlyWithValueOf', () => {
  const SUPPORTED = ['ANALOG', 'ANGULAR', 'NUXT', 'ASTRO', 'REMIX', 'OTHER'];

  it('passes when the gated flag was not supplied at all, whatever the gate says', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule(...typed({ framework: 'NEXTJS' }))).not.toThrow();
    expect(() => rule({}, {})).not.toThrow();
  });

  it('passes when the gated value came only from a default, whatever the gate says', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() =>
      rule({ 'server-cmd': 'npm start', framework: 'NEXTJS' }, { 'server-cmd': 'default', framework: 'flag' }),
    ).not.toThrow();
  });

  it('passes when the gate value is one the rule allows', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    for (const framework of SUPPORTED) {
      expect(() => rule(...typed({ 'server-cmd': 'npm start', framework }))).not.toThrow();
    }
  });

  it('reads the gate value wherever it came from, including a default', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() =>
      rule({ 'server-cmd': 'npm start', framework: 'NUXT' }, { 'server-cmd': 'flag', framework: 'default' }),
    ).not.toThrow();
  });

  it('fails naming every supported value and the value it actually found', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule(...typed({ 'server-cmd': 'npm start', framework: 'NEXTJS' }))).toThrow(UsageError);
    expect(() => rule(...typed({ 'server-cmd': 'npm start', framework: 'NEXTJS' }))).toThrow(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is NEXTJS.',
    );
  });

  it('fails saying the gate was not supplied when there is no gate value to report', () => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);
    const expected =
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
      '--framework was not supplied.';

    expect(() => rule(...typed({ 'server-cmd': 'npm start' }))).toThrow(expected);
    expect(() => rule(...typed({ 'server-cmd': 'npm start', framework: undefined }))).toThrow(expected);
    expect(() => rule(...typed({ 'server-cmd': 'npm start', framework: null }))).toThrow(expected);
    expect(() => rule(...typed({ 'server-cmd': 'npm start', framework: '' }))).toThrow(expected);
    expect(() => rule(...typed({ 'server-cmd': 'npm start', framework: 7 }))).toThrow(expected);
  });

  it.each([[null], [undefined], [false], [''], ['   ']])('does not gate on %p as a supplied gated value', (value) => {
    const rule = onlyWithValueOf('server-cmd', 'framework', SUPPORTED);

    expect(() => rule(...typed({ 'server-cmd': value, framework: 'NEXTJS' }))).not.toThrow();
  });
});
