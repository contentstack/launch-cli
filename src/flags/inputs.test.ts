import { Catalog, catalog } from './catalog';
import { flagsFor, inputs } from './inputs';

describe('inputs and flagsFor', () => {
  it('returns the declaration unchanged and derives exactly the declared oclif flags', () => {
    const declared = inputs({ org: { required: true }, limit: {}, skip: {} });
    const derived = flagsFor(declared);

    expect(declared).toEqual({ org: { required: true }, limit: {}, skip: {} });
    expect(Object.keys(derived).sort()).toEqual(['limit', 'org', 'skip']);
    expect(derived.org).toBe(catalog.org);
    expect(derived.limit).toBe(catalog.limit);
  });

  it('keeps the derived type narrowed to the declared keys', () => {
    const derived: Pick<Catalog, 'org'> = flagsFor(inputs({ org: { required: true } }));

    expect(derived.org).toBe(catalog.org);
  });

  it('returns an empty object when the spec has no keys', () => {
    const declared = inputs({});
    const derived = flagsFor(declared);

    expect(declared).toEqual({});
    expect(Object.keys(derived)).toEqual([]);
  });
});

describe('catalog', () => {
  it('never marks a flag required, because required-ness belongs to the resolution layer', () => {
    for (const flag of Object.values(catalog)) {
      expect((flag as { required?: boolean }).required).toBeFalsy();
    }
  });

  it('gives --org no short character, per the Commands Details all-flags table', () => {
    expect((catalog.org as { char?: string }).char).toBeUndefined();
  });

  it('has no --organization alias for --org, per the controller ruling', () => {
    expect(Object.keys(catalog)).not.toContain('organization');
    expect((catalog.org as { aliases?: string[] }).aliases ?? []).not.toContain('organization');
  });
});
