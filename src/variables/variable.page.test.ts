import { pageOfVariables } from './variable.page';

const THREE = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];

describe('variable page', () => {
  it('returns the window starting at skip and holding at most limit variables with the total count', () => {
    const page = pageOfVariables(THREE, 1, 1);

    expect(page).toEqual({ variables: [{ key: 'B' }], pagination: { count: 3, limit: 1, skip: 1 } });
  });

  it('returns every variable when limit is exactly the number held', () => {
    expect(pageOfVariables(THREE, 3, 0).variables).toEqual(THREE);
  });

  it('returns the remainder when limit runs past the end', () => {
    expect(pageOfVariables(THREE, 100, 2).variables).toEqual([{ key: 'C' }]);
  });

  it('returns nothing when skip equals the number held, still reporting the total', () => {
    expect(pageOfVariables(THREE, 10, 3)).toEqual({ variables: [], pagination: { count: 3, limit: 10, skip: 3 } });
  });

  it('returns nothing when skip is past the end', () => {
    expect(pageOfVariables(THREE, 10, 99).variables).toEqual([]);
  });

  it('returns nothing and a zero count when the environment holds no variables', () => {
    expect(pageOfVariables([], 100, 0)).toEqual({ variables: [], pagination: { count: 0, limit: 100, skip: 0 } });
  });

  it('does not alter the list it was given', () => {
    const held = [...THREE];

    pageOfVariables(held, 1, 1);

    expect(held).toEqual(THREE);
  });
});
