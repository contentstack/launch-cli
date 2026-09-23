import { UsageError } from './errors';
import { dependsOnValue, exactlyOneOf, requiresFrameworkIn } from './rules';

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

describe('dependsOnValue', () => {
  it('passes when the dependents are supplied and the gating input holds the required value', () => {
    const rule = dependsOnValue('project', 'enable', 'org', 'limit');

    expect(() => rule({ project: 'enable', org: 'org1', limit: 10 })).not.toThrow();
  });

  it('passes when the gating input holds another value and no dependent was supplied', () => {
    const rule = dependsOnValue('project', 'enable', 'org', 'limit');

    expect(() => rule({ project: 'disable' })).not.toThrow();
  });

  it('fails naming the dependents that were supplied while the gating input holds another value', () => {
    const rule = dependsOnValue('project', 'enable', 'org', 'limit');

    expect(() => rule({ project: 'disable', org: 'org1' })).toThrow(UsageError);
    expect(() => rule({ project: 'disable', org: 'org1' })).toThrow('--org requires --project enable.');
  });

  it('fails when the gating input is absent entirely and a dependent was supplied', () => {
    const rule = dependsOnValue('project', 'enable', 'org', 'limit');

    expect(() => rule({ org: 'org1' })).toThrow(UsageError);
    expect(() => rule({ org: 'org1' })).toThrow('--org requires --project enable.');
  });

  it('passes when the gating input is absent entirely and no dependent was supplied', () => {
    const rule = dependsOnValue('project', 'enable', 'org', 'limit');

    expect(() => rule({})).not.toThrow();
    expect(() => rule({ org: null, limit: false })).not.toThrow();
  });
});

describe('requiresFrameworkIn', () => {
  it('passes when the server command is supplied and the resolved framework is in the list', () => {
    const rule = requiresFrameworkIn(['NEXTJS', 'REMIX']);

    expect(() => rule({ 'server-cmd': 'npm start', framework: 'REMIX' })).not.toThrow();
  });

  it('passes when no server command was supplied, whatever the framework is', () => {
    const rule = requiresFrameworkIn(['NEXTJS', 'REMIX']);

    expect(() => rule({ framework: 'GATSBY' })).not.toThrow();
  });

  it('fails naming the supported frameworks when the resolved framework is not one of them', () => {
    const rule = requiresFrameworkIn(['NEXTJS', 'REMIX']);

    expect(() => rule({ 'server-cmd': 'npm start', framework: 'GATSBY' })).toThrow(UsageError);
    expect(() => rule({ 'server-cmd': 'npm start', framework: 'GATSBY' })).toThrow(
      '--server-cmd applies only to the NEXTJS, REMIX frameworks.',
    );
  });

  it('fails when a server command is supplied with no resolved framework at all', () => {
    const rule = requiresFrameworkIn(['NEXTJS', 'REMIX']);

    expect(() => rule({ 'server-cmd': 'npm start' })).toThrow(UsageError);
    expect(() => rule({ 'server-cmd': 'npm start' })).toThrow(
      '--server-cmd applies only to the NEXTJS, REMIX frameworks.',
    );
  });
});
