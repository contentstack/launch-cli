type LogPollingCtor = typeof import('./logs-polling-utilities').default;

const CONFIG = {
  deployment: 'd1',
  environment: 'e1',
  pollingInterval: 1000,
};

function getDeploymentStatus(LogPollingClass: LogPollingCtor, watchQuery: jest.Mock): void {
  new LogPollingClass({
    apolloManageClient: { watchQuery } as any,
    apolloLogsClient: {} as any,
    config: CONFIG as any,
  }).getDeploymentStatus();
}

describe('LogPolling Apollo deprecation regression', () => {
  let LogPolling: LogPollingCtor;

  async function reloadLogPolling(innerRequire: jest.Mock): Promise<void> {
    jest.resetModules();
    jest.doMock('./apollo-client', () => ({
      isNotDevelopment: true,
    }));
    jest.doMock('module', () => {
      const actual = jest.requireActual<typeof import('module')>('module');
      return {
        ...actual,
        createRequire: jest.fn(() => innerRequire),
      };
    });
    ({ default: LogPolling } = await import('./logs-polling-utilities'));
  }

  afterEach(() => {
    jest.dontMock('module');
    jest.dontMock('./apollo-client');
    jest.resetModules();
  });

  it('does not throw when withDisabledDeprecations is not a function', async () => {
    await reloadLogPolling(
      jest.fn().mockReturnValue({
        withDisabledDeprecations: undefined,
      }),
    );

    const watchQuery = jest.fn().mockReturnValue({ subscribe: jest.fn() });

    expect(() => getDeploymentStatus(LogPolling, watchQuery)).not.toThrow();
    expect(watchQuery).toHaveBeenCalledTimes(1);
  });

  it('does not throw when @apollo/client/utilities/deprecation cannot be required', async () => {
    await reloadLogPolling(
      jest.fn().mockImplementation(() => {
        throw new Error('MODULE_NOT_FOUND');
      }),
    );

    const watchQuery = jest.fn().mockReturnValue({ subscribe: jest.fn() });

    expect(() => getDeploymentStatus(LogPolling, watchQuery)).not.toThrow();
    expect(watchQuery).toHaveBeenCalledTimes(1);
  });

  it('throws when apolloManageClient.watchQuery throws and deprecation helper is skipped', async () => {
    await reloadLogPolling(
      jest.fn().mockReturnValue({
        withDisabledDeprecations: 'undefined',
      }),
    );

    const err = new Error('watchQuery failed');
    const watchQuery = jest.fn().mockImplementation(() => {
      throw err;
    });

    expect(() => getDeploymentStatus(LogPolling, watchQuery)).toThrow(err);
    expect(watchQuery).toHaveBeenCalledTimes(1);
  });

  it('throws when withDisabledDeprecations throws when invoked', async () => {
    await reloadLogPolling(
      jest.fn().mockReturnValue({
        withDisabledDeprecations: () => {
          throw new Error('deprecation init failed');
        },
      }),
    );

    const watchQuery = jest.fn().mockReturnValue({ subscribe: jest.fn() });

    expect(() => getDeploymentStatus(LogPolling, watchQuery)).toThrow('deprecation init failed');
    expect(watchQuery).not.toHaveBeenCalled();
  });

  it('throws when apolloManageClient.watchQuery throws inside deprecation wrapper', async () => {
    await reloadLogPolling(
      jest.fn().mockReturnValue({
        withDisabledDeprecations: () => ({}),
      }),
    );

    const err = new Error('watchQuery failed after deprecation');
    const watchQuery = jest.fn().mockImplementation(() => {
      throw err;
    });

    expect(() => getDeploymentStatus(LogPolling, watchQuery)).toThrow(err);
    expect(watchQuery).toHaveBeenCalledTimes(1);
  });
});
