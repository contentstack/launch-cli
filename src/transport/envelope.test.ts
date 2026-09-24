import { LaunchApiError } from './errors';
import { MALFORMED_CODE, assertArray, assertPage, isRecord, malformed, unwrap } from './envelope';

function failureFrom(act: () => unknown): LaunchApiError {
  try {
    act();
  } catch (error) {
    return error as LaunchApiError;
  }

  throw new Error('the call was expected to throw and did not');
}

describe('response envelope', () => {
  it('reports a malformed body as an http 200 LaunchApiError carrying the wire code', () => {
    const error = malformed('The Launch API returned nonsense.');

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(200);
    expect(error.code).toBe(MALFORMED_CODE);
    expect(MALFORMED_CODE).toBe('launch.RESPONSE.MALFORMED');
    expect(error.message).toBe('The Launch API returned nonsense.');
  });

  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], true],
    [null, false],
    [undefined, false],
    ['', false],
    [0, false],
    [false, false],
  ])('treats %p as a record: %p', (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });

  it('returns the member the envelope carries', () => {
    expect(unwrap<{ uid: string }>({ project: { uid: 'p1' } }, 'project', 'a project response')).toEqual({ uid: 'p1' });
  });

  it.each([
    [undefined],
    [null],
    ['a string'],
    [{}],
    [{ project: null }],
    [{ project: 'p1' }],
  ])('refuses %p as an envelope that carries no project', (response) => {
    const error = failureFrom(() => unwrap(response, 'project', 'a project response'));

    expect(error.code).toBe(MALFORMED_CODE);
    expect(error.message).toBe('The Launch API returned a project response without a project.');
  });

  it('chooses the article from the key so the wording reads correctly', () => {
    expect(failureFrom(() => unwrap({}, 'environment', 'an environment response')).message).toBe(
      'The Launch API returned an environment response without an environment.',
    );
    expect(failureFrom(() => assertArray({}, 'environments', 'an environment list')).message).toBe(
      'The Launch API returned an environment list without an environments array.',
    );
    expect(failureFrom(() => assertArray({}, 'deployments', 'a deployment list')).message).toBe(
      'The Launch API returned a deployment list without a deployments array.',
    );
  });

  it('accepts a page that carries both the array and the pagination block', () => {
    expect(() => assertPage({ projects: [], pagination: {} }, 'projects', 'a project list')).not.toThrow();
  });

  it.each([[undefined], [null], ['a string'], [{}], [{ projects: {} }], [{ projects: 'no' }]])(
    'refuses %p as a page that carries no projects array',
    (response) => {
      const error = failureFrom(() => assertPage(response, 'projects', 'a project list'));

      expect(error.code).toBe(MALFORMED_CODE);
      expect(error.message).toBe('The Launch API returned a project list without a projects array.');
    },
  );

  it.each([[{ projects: [] }], [{ projects: [], pagination: null }], [{ projects: [], pagination: 'no' }]])(
    'refuses %p as a page that carries no pagination block',
    (response) => {
      const error = failureFrom(() => assertPage(response, 'projects', 'a project list'));

      expect(error.message).toBe('The Launch API returned a project list without a pagination block.');
    },
  );
});
