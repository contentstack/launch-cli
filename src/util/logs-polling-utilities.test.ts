import { EventEmitter } from 'events';
import { logPolling as cliUtilitiesJestMock } from '../test/mocks/cli-utilities';
import LogPolling from './logs-polling-utilities';
import defaultConfig from '../config';

type LogPollingCtor = typeof import('./logs-polling-utilities').default;

jest.mock('@contentstack/cli-utilities', () => cliUtilitiesJestMock);
jest.mock('timers/promises', () => ({ setTimeout: jest.fn().mockResolvedValue(undefined) }));

function makeWatchQuery() {
  let subscriber: (result: any) => void = () => {};
  return {
    subscribe: jest.fn((cb: (result: any) => void) => {
      subscriber = cb;
      return { unsubscribe: jest.fn() };
    }),
    setVariables: jest.fn(),
    stopPolling: jest.fn(),
    emit: (result: any) => subscriber(result),
  };
}

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

describe('cancelled deployment stops log polling', () => {
  function buildInstance(deploymentStatus: string[]) {
    const statusWatchQuery = makeWatchQuery();
    const logsWatchQuery = makeWatchQuery();
    const config = {
      deployment: 'd1',
      environment: 'e1',
      pollingInterval: 1000,
      deploymentStatus,
    };
    const instance = new LogPolling({
      apolloManageClient: { watchQuery: jest.fn().mockReturnValue(statusWatchQuery) } as any,
      apolloLogsClient: { watchQuery: jest.fn().mockReturnValue(logsWatchQuery) } as any,
      config: config as any,
      $event: new EventEmitter(),
    });
    return { instance, statusWatchQuery, logsWatchQuery, config };
  }

  it('stops status polling once the deployment status is CANCELLED', async () => {
    const { instance, statusWatchQuery } = buildInstance(['LIVE', 'FAILED', 'SKIPPED', 'DEPLOYED', 'CANCELLED']);

    await instance.deploymentLogs();
    statusWatchQuery.emit({ data: { Deployment: { status: 'CANCELLED' } } });

    expect(instance.deploymentStatus).toBe('CANCELLED');
    expect(statusWatchQuery.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('stops deployment-logs polling and emits DONE once status is CANCELLED', async () => {
    const { instance, statusWatchQuery, logsWatchQuery } = buildInstance([
      'LIVE',
      'FAILED',
      'SKIPPED',
      'DEPLOYED',
      'CANCELLED',
    ]);
    const events: string[] = [];
    (instance as any).$event.on('deployment-logs', (e: any) => events.push(e.message));

    await instance.deploymentLogs();
    statusWatchQuery.emit({ data: { Deployment: { status: 'CANCELLED' } } });
    await logsWatchQuery.emit({ data: { getLogs: [] } });

    expect(logsWatchQuery.stopPolling).toHaveBeenCalledTimes(1);
    expect(events).toContain('DONE');
  });

  it('regression guard: keeps polling forever if CANCELLED is missing from deploymentStatus', async () => {
    const { instance, statusWatchQuery } = buildInstance(['LIVE', 'FAILED', 'SKIPPED', 'DEPLOYED']);

    await instance.deploymentLogs();
    statusWatchQuery.emit({ data: { Deployment: { status: 'CANCELLED' } } });

    expect(instance.deploymentStatus).toBe('CANCELLED');
    expect(statusWatchQuery.stopPolling).not.toHaveBeenCalled();
  });

  it('real app config (src/config) lists CANCELLED as a terminal deployment status', () => {
    expect(defaultConfig.deploymentStatus).toContain('CANCELLED');
  });
});
