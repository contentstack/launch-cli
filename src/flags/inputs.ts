import { Catalog, FlagKey, catalog } from './catalog';
import type { DependenciesOf } from './resolution';

export interface InputSpec {
  required?: boolean;
}

export type InputsSpec<K extends FlagKey> = { [P in K]: InputSpec };

export type InputsSpecWithDependencies<K extends FlagKey> = InputsSpec<K> & {
  [P in Exclude<DependenciesOf<K>, K>]: InputSpec;
};

export function inputs<K extends FlagKey>(spec: InputsSpecWithDependencies<K>): InputsSpec<K> {
  return spec;
}

export function flagsFor<K extends FlagKey>(spec: InputsSpec<K>): Pick<Catalog, K> {
  const picked = {} as Pick<Catalog, K>;

  for (const key of Object.keys(spec) as K[]) {
    picked[key] = catalog[key];
  }

  return picked;
}
