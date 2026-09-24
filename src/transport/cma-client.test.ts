import { configHandler, managementSDKClient, managementSDKInitiator } from '@contentstack/cli-utilities';

import { OAUTH_ORGANIZATION_KEY, cmaHostOf, createCmaSession } from './cma-client';

jest.mock('@contentstack/cli-utilities', () => ({
  ...jest.requireActual('@contentstack/cli-utilities'),
  managementSDKClient: jest.fn(),
  managementSDKInitiator: { init: jest.fn() },
}));

const sdkClient = managementSDKClient as unknown as jest.Mock;
const sdkInit = managementSDKInitiator.init as unknown as jest.Mock;

function fakeSdk() {
  const calls: { organization: unknown[][]; fetchAll: unknown[]; fetch: number } = {
    organization: [],
    fetchAll: [],
    fetch: 0,
  };
  const client = {
    organization: (...args: unknown[]) => {
      calls.organization.push(args);
      return {
        fetchAll: async (query: unknown) => {
          calls.fetchAll.push(query);
          return { items: [{ uid: 'org1' }], count: 1 };
        },
        fetch: async () => {
          calls.fetch += 1;
          return { uid: args[0], name: 'Scoped' };
        },
      };
    },
  };

  sdkClient.mockReset();
  sdkClient.mockResolvedValue(client);
  sdkInit.mockReset();

  return calls;
}

describe('cmaHostOf', () => {
  it('reduces a region cma url to the host the management SDK expects', () => {
    expect(cmaHostOf('https://eu-api.contentstack.com')).toBe('eu-api.contentstack.com');
    expect(cmaHostOf('https://api.contentstack.io/v3')).toBe('api.contentstack.io');
    expect(cmaHostOf('http://localhost:8080')).toBe('localhost:8080');
  });

  it('keeps a region cma that is already a bare host', () => {
    expect(cmaHostOf('api.contentstack.io')).toBe('api.contentstack.io');
  });
});

describe('createCmaSession', () => {
  it('lists organizations through the SDK with the query it was handed, on the region host', async () => {
    const calls = fakeSdk();
    const session = createCmaSession({ cma: 'https://eu-api.contentstack.com', analyticsInfo: 'cli/2.0.0' });
    const query = { limit: 100, asc: 'name', include_count: true, skip: 0 };

    await expect(session.fetchOrganizations(query)).resolves.toEqual({ items: [{ uid: 'org1' }], count: 1 });

    expect(sdkInit).toHaveBeenCalledWith({ analyticsInfo: 'cli/2.0.0' });
    expect(sdkClient).toHaveBeenCalledWith({ host: 'eu-api.contentstack.com' });
    expect(calls.organization).toEqual([[]]);
    expect(calls.fetchAll).toEqual([query]);
  });

  it('fetches one organization by the uid it was handed', async () => {
    const calls = fakeSdk();
    const session = createCmaSession({ cma: 'https://api.contentstack.io', analyticsInfo: 'cli/2.0.0' });

    await expect(session.fetchOrganization('org7')).resolves.toEqual({ uid: 'org7', name: 'Scoped' });

    expect(calls.organization).toEqual([['org7']]);
    expect(calls.fetch).toBe(1);
  });

  it('opens one SDK client per session however many pages it fetches', async () => {
    const calls = fakeSdk();
    const session = createCmaSession({ cma: 'https://api.contentstack.io', analyticsInfo: 'cli/2.0.0' });

    await session.fetchOrganizations({ skip: 0 });
    await session.fetchOrganizations({ skip: 100 });
    await session.fetchOrganization('org7');

    expect(sdkClient).toHaveBeenCalledTimes(1);
    expect(sdkInit).toHaveBeenCalledTimes(1);
    expect(calls.fetchAll).toEqual([{ skip: 0 }, { skip: 100 }]);
  });

  it.each([[undefined], [''], ['   ']])('refuses to open a client when the region cma is %p', async (cma) => {
    fakeSdk();
    const session = createCmaSession({ cma, analyticsInfo: 'cli/2.0.0' });

    await expect(session.fetchOrganizations({})).rejects.toThrow(
      'No Contentstack Management API host is configured for this region.',
    );
    expect(sdkClient).not.toHaveBeenCalled();
    expect(sdkInit).not.toHaveBeenCalled();
  });

  it('propagates a failure to open the SDK client', async () => {
    fakeSdk();
    sdkClient.mockRejectedValue(new Error('token refresh failed'));
    const session = createCmaSession({ cma: 'https://api.contentstack.io', analyticsInfo: 'cli/2.0.0' });

    await expect(session.fetchOrganizations({})).rejects.toThrow('token refresh failed');
  });

  it('reads the organization an OAuth session is scoped to from the CLI config', () => {
    const spy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) =>
      key === OAUTH_ORGANIZATION_KEY ? 'org7' : undefined,
    );

    expect(createCmaSession({ analyticsInfo: 'cli/2.0.0' }).scopedOrganizationUid()).toBe('org7');
    expect(spy).toHaveBeenCalledWith('oauthOrgUid');
  });

  it.each([[undefined], [null], [''], ['   '], [42]])('reports no scoped organization when the config holds %p', (value) => {
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) =>
      key === OAUTH_ORGANIZATION_KEY ? value : undefined,
    );

    expect(createCmaSession({ analyticsInfo: 'cli/2.0.0' }).scopedOrganizationUid()).toBeUndefined();
  });
});
