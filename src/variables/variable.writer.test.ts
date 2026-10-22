import { UsageError } from '../core/errors';
import type { EnvironmentParams } from '../environments/environments.api';
import type { Environment, EnvironmentUpdate } from '../environments/types';
import { UnreadableVariablesError, missingKeys, setVariables, unsetVariables } from './variable.writer';

const PARAMS: EnvironmentParams = { org: 'org1', project: 'proj1', environment: 'env1' };

function fakeApi(environment: Environment, failOn?: 'get' | 'update') {
  const calls: { method: 'get' | 'update'; params: unknown }[] = [];

  return {
    calls,
    api: {
      get: async (params: EnvironmentParams) => {
        calls.push({ method: 'get', params });

        if (failOn === 'get') {
          throw new Error('get failed');
        }

        return environment;
      },
      update: async (params: EnvironmentParams & { update: EnvironmentUpdate }) => {
        calls.push({ method: 'update', params });

        if (failOn === 'update') {
          throw new Error('update failed');
        }

        return { ...environment, environmentVariables: params.update.environmentVariables };
      },
    },
  };
}

describe('variable writer set', () => {
  it('reads the environment, then sends the complete merged array and nothing else', async () => {
    const { api, calls } = fakeApi({
      uid: 'env1',
      name: 'staging',
      environmentVariables: [{ key: 'KEEP', value: 'k' }, { key: 'CHANGE', value: 'old' }],
    });

    const environment = await setVariables(api, PARAMS, [{ key: 'CHANGE', value: 'new' }, { key: 'ADD', value: 'a' }]);

    expect(calls.map((call) => call.method)).toEqual(['get', 'update']);
    expect(calls[0].params).toEqual(PARAMS);
    expect(calls[1].params).toEqual({
      ...PARAMS,
      update: {
        environmentVariables: [
          { key: 'KEEP', value: 'k' },
          { key: 'CHANGE', value: 'new' },
          { key: 'ADD', value: 'a' },
        ],
      },
    });
    expect(environment?.name).toBe('staging');
  });

  it('leaves every other variable intact on a single-key set', async () => {
    const { api, calls } = fakeApi({ environmentVariables: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] });

    await setVariables(api, PARAMS, [{ key: 'C', value: '3' }]);

    expect((calls[1].params as { update: EnvironmentUpdate }).update.environmentVariables).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
      { key: 'C', value: '3' },
    ]);
  });

  it.each([[{}], [{ environmentVariables: null }], [{ environmentVariables: [] }]])(
    'sets into an environment that holds no variables yet (%p)',
    async (environment) => {
      const { api, calls } = fakeApi(environment as Environment);

      await setVariables(api, PARAMS, [{ key: 'A', value: '1' }]);

      expect((calls[1].params as { update: EnvironmentUpdate }).update).toEqual({
        environmentVariables: [{ key: 'A', value: '1' }],
      });
    },
  );

  it.each([
    [{ value: 'orphan' }, ''],
    [{ key: 'NOVALUE' }, ' (NOVALUE)'],
    [{ key: 'EMPTY', value: '' }, ' (EMPTY)'],
  ])('refuses to set when a stored variable cannot be sent back, writing nothing (%p)', async (stored, named) => {
    const { api, calls } = fakeApi({ environmentVariables: [{ key: 'GOOD', value: 'g' }, stored] });

    const error = await setVariables(api, PARAMS, [{ key: 'NEW', value: 'n' }]).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UnreadableVariablesError);
    expect((error as Error).message).toBe(
      `This environment holds variables the API returned without a value${named}. Updating the list would delete them, so nothing was changed.`,
    );
    expect(calls.map((call) => call.method)).toEqual(['get']);
  });

  it('refuses to unset when a stored variable cannot be sent back, writing nothing', async () => {
    const { api, calls } = fakeApi({ environmentVariables: [{ key: 'A', value: '1' }, { key: 'HIDDEN' }] });

    await expect(unsetVariables(api, PARAMS, ['A'])).rejects.toBeInstanceOf(UnreadableVariablesError);
    expect(calls.filter((call) => call.method === 'update')).toEqual([]);
  });

  it('sends nothing when there is nothing to set, without even reading', async () => {
    const { api, calls } = fakeApi({});

    expect(await setVariables(api, PARAMS, [])).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('propagates a failed read without writing and a failed write', async () => {
    const reading = fakeApi({}, 'get');

    await expect(setVariables(reading.api, PARAMS, [{ key: 'A', value: '1' }])).rejects.toThrow('get failed');
    expect(reading.calls.map((call) => call.method)).toEqual(['get']);

    const writing = fakeApi({}, 'update');

    await expect(setVariables(writing.api, PARAMS, [{ key: 'A', value: '1' }])).rejects.toThrow('update failed');
  });
});

describe('variable writer unset', () => {
  it('removes only the named keys and sends the rest as the complete array', async () => {
    const { api, calls } = fakeApi({
      environmentVariables: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }, { key: 'C', value: '3' }],
    });

    const removed = await unsetVariables(api, PARAMS, ['B']);

    expect(removed).toEqual(['B']);
    expect(calls.map((call) => call.method)).toEqual(['get', 'update']);
    expect((calls[1].params as { update: EnvironmentUpdate }).update).toEqual({
      environmentVariables: [{ key: 'A', value: '1' }, { key: 'C', value: '3' }],
    });
  });

  it('sends an empty array when the last variable is removed', async () => {
    const { api, calls } = fakeApi({ environmentVariables: [{ key: 'A', value: '1' }] });

    await unsetVariables(api, PARAMS, ['A']);

    expect((calls[1].params as { update: EnvironmentUpdate }).update).toEqual({ environmentVariables: [] });
  });

  it('removes a key named twice once', async () => {
    const { api } = fakeApi({ environmentVariables: [{ key: 'A', value: '1' }] });

    expect(await unsetVariables(api, PARAMS, ['A', 'A'])).toEqual(['A']);
  });

  it('refuses a key that is not set, naming every missing key, and writes nothing', async () => {
    const { api, calls } = fakeApi({ environmentVariables: [{ key: 'A', value: '1' }] });

    await expect(unsetVariables(api, PARAMS, ['A', 'X', 'Y'])).rejects.toThrow(UsageError);
    await expect(unsetVariables(api, PARAMS, ['A', 'X', 'Y'])).rejects.toThrow('X, Y are not set in this environment.');
    expect(calls.filter((call) => call.method === 'update')).toEqual([]);
  });

  it('uses the singular for a single missing key and matches keys case-sensitively', async () => {
    const { api } = fakeApi({ environmentVariables: [{ key: 'api_key', value: '1' }] });

    await expect(unsetVariables(api, PARAMS, ['API_KEY'])).rejects.toThrow('API_KEY is not set in this environment.');
  });

  it.each([[{}], [{ environmentVariables: null }]])('refuses every key on an environment with no variables (%p)', async (environment) => {
    const { api } = fakeApi(environment as Environment);

    await expect(unsetVariables(api, PARAMS, ['A'])).rejects.toThrow('A is not set in this environment.');
  });

  it('sends nothing when no key is named, without even reading', async () => {
    const { api, calls } = fakeApi({});

    expect(await unsetVariables(api, PARAMS, [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('propagates a failed read and a failed write', async () => {
    await expect(unsetVariables(fakeApi({}, 'get').api, PARAMS, ['A'])).rejects.toThrow('get failed');
    await expect(
      unsetVariables(fakeApi({ environmentVariables: [{ key: 'A', value: '1' }] }, 'update').api, PARAMS, ['A']),
    ).rejects.toThrow('update failed');
  });
});

describe('variable writer missing keys', () => {
  it('lists the wanted keys the environment does not hold, once each, in the order given', () => {
    const environment = { environmentVariables: [{ key: 'A', value: '1' }] };

    expect(missingKeys(environment, ['X', 'A', 'Y', 'X'])).toEqual(['X', 'Y']);
  });

  it('counts a stored entry with no key or no value as not set', () => {
    expect(missingKeys({ environmentVariables: [{ key: 'A' }, { value: 'v' }] }, ['A'])).toEqual(['A']);
  });

  it.each([[{}], [{ environmentVariables: null }]])('treats an environment with no variables as holding none (%p)', (environment) => {
    expect(missingKeys(environment as Environment, ['A'])).toEqual(['A']);
  });

  it('returns nothing when every key is held', () => {
    expect(missingKeys({ environmentVariables: [{ key: 'A', value: '1' }] }, ['A'])).toEqual([]);
  });
});
