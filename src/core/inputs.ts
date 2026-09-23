import type { Interfaces } from '@oclif/core';

import { Catalog, FlagKey, catalog } from './catalog';
import type { DependenciesOf, Resolution } from './resolution';

export interface InputSpec {
  required?: boolean;
}

export type InputsSpec<K extends FlagKey> = { [P in K]: InputSpec };

export type AnyInputs = { readonly [key: string]: InputSpec };

export type InputKeys<S> = Extract<keyof S, FlagKey>;

export type ValueOf<F> = F extends Interfaces.OptionFlag<infer T>
  ? NonNullable<T>
  : F extends Interfaces.BooleanFlag<infer B>
    ? B
    : never;

type HasDefault<P extends FlagKey> = 'default' extends keyof Resolution[P] ? true : false;

type IsCertain<S, P extends FlagKey> = P extends keyof S
  ? S[P] extends { required: true }
    ? true
    : HasDefault<P>
  : false;

export type Resolved<S> = {
  [P in InputKeys<S>]: IsCertain<S, P> extends true ? ValueOf<Catalog[P]> : ValueOf<Catalog[P]> | undefined;
};

export type MissingDependencies<S> = {
  [P in Exclude<DependenciesOf<InputKeys<S>>, InputKeys<S>>]: InputSpec;
};

export type UnknownFlags<S> = Record<Exclude<keyof S, FlagKey>, never>;

export function inputs<const S extends AnyInputs>(spec: S & MissingDependencies<S> & UnknownFlags<S>): S {
  return spec;
}

export function flagsFor<S extends AnyInputs>(spec: S): Pick<Catalog, InputKeys<S>> {
  const picked = {} as Pick<Catalog, InputKeys<S>>;

  for (const key of Object.keys(spec) as InputKeys<S>[]) {
    picked[key] = catalog[key];
  }

  return picked;
}
