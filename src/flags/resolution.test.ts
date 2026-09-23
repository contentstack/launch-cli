import { catalog } from './catalog';
import { resolution } from './resolution';

describe('resolution', () => {
  it('declares a rule for every catalog flag and no rule for anything else', () => {
    expect(Object.keys(resolution).sort()).toEqual(Object.keys(catalog).sort());
  });

  it('does not silently pass when a catalog flag is missing a resolution entry', () => {
    const incomplete = { ...resolution } as Record<string, unknown>;
    delete incomplete.skip;

    expect(Object.keys(incomplete).sort()).not.toEqual(Object.keys(catalog).sort());
  });

  it('does not silently pass when resolution has an entry the catalog does not', () => {
    const withExtra = { ...resolution, bogus: {} } as Record<string, unknown>;

    expect(Object.keys(withExtra).sort()).not.toEqual(Object.keys(catalog).sort());
  });
});
