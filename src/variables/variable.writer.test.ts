import type { EnvironmentParams } from '../environments/environments.api';
import type { Environment } from '../environments/types';
import type { PatchVariablesParams } from './variables.api';
import { missingKeys, setVariables, unsetVariables } from './variable.writer';

const PARAMS: EnvironmentParams = { org: 'org1', project: 'proj1', environment: 'env1' };

function fakeStore(failure?: Error) {
  const patches: PatchVariablesParams[] = [];

  return {
    patches,
    store: {
      patch: async (params: PatchVariablesParams) => {
        patches.push(params);

        if (failure !== undefined) {
          throw failure;
        }
      },
    },
  };
}

describe('variable writer set', () => {
  it('sends only the variables to set, without reading the environment first', async () => {
    const { store, patches } = fakeStore();

    await setVariables(store, PARAMS, [{ key: 'CHANGE', value: 'new' }, { key: 'ADD', value: 'a' }]);

    expect(patches).toEqual([{ ...PARAMS, set: [{ key: 'CHANGE', value: 'new' }, { key: 'ADD', value: 'a' }] }]);
  });

  it('sends nothing when there is nothing to set', async () => {
    const { store, patches } = fakeStore();

    await setVariables(store, PARAMS, []);

    expect(patches).toEqual([]);
  });

  it('propagates a failed patch', async () => {
    const { store } = fakeStore(new Error('patch failed'));

    await expect(setVariables(store, PARAMS, [{ key: 'A', value: '1' }])).rejects.toThrow('patch failed');
  });
});

describe('variable writer unset', () => {
  it('sends only the keys to unset, once each, and returns them', async () => {
    const { store, patches } = fakeStore();

    const removed = await unsetVariables(store, PARAMS, ['B', 'C', 'B']);

    expect(removed).toEqual(['B', 'C']);
    expect(patches).toEqual([{ ...PARAMS, unset: ['B', 'C'] }]);
  });

  it('sends nothing when no key is named', async () => {
    const { store, patches } = fakeStore();

    expect(await unsetVariables(store, PARAMS, [])).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('propagates a failed patch', async () => {
    const { store } = fakeStore(new Error('patch failed'));

    await expect(unsetVariables(store, PARAMS, ['A'])).rejects.toThrow('patch failed');
  });
});

describe('variable writer missing keys', () => {
  it('lists the wanted keys the environment does not hold, once each, in the order given', () => {
    const environment = { environmentVariables: [{ key: 'A', value: '1' }] };

    expect(missingKeys(environment, ['X', 'A', 'Y', 'X'])).toEqual(['X', 'Y']);
  });

  it('counts a stored key as held even when the API gave no value for it', () => {
    expect(missingKeys({ environmentVariables: [{ key: 'A' }, { value: 'v' }] }, ['A'])).toEqual([]);
  });

  it.each([[{}], [{ environmentVariables: null }]])('treats an environment with no variables as holding none (%p)', (environment) => {
    expect(missingKeys(environment as Environment, ['A'])).toEqual(['A']);
  });

  it('returns nothing when every key is held', () => {
    expect(missingKeys({ environmentVariables: [{ key: 'A', value: '1' }] }, ['A'])).toEqual([]);
  });
});
