import { EventEmitter } from 'events';
import { logPolling as cliUtilitiesJestMock } from '../test/mocks/cli-utilities';
import LogPolling from './logs-polling-utilities';
import defaultConfig from '../config';

type LogPollingCtor = typeof import('./logs-polling-utilities').default;

jest.mock('@contentstack/cli-utilities', () => cliUtilitiesJestMock);
jest.mock('timers/promises', () => ({ setTimeout: jest.fn().mockResolvedValue(undefined) }));

const CONFIG = {
  deployment: 'd1',
  environment: 'e1',
  pollingInterval: 1000,
};

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

function page(logs: any[], pageInfo: Record<string, unknown> = {}) {
  return {
    logs,
    pageInfo: { hasNewer: null, newestCursor: null, ...pageInfo },
  };
}

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

describe('deployment logs use cursor paging (getDeploymentLogsV2)', () => {
  function buildInstance(deploymentStatus: string[] = ['DEPLOYED']) {
    const statusWatchQuery = makeWatchQuery();
    const logsWatchQuery = makeWatchQuery();
    const fallbackWatchQuery = makeWatchQuery();
    const logsClientWatchQuery = jest
      .fn()
      .mockReturnValueOnce(logsWatchQuery)
      .mockReturnValue(fallbackWatchQuery);
    const instance = new LogPolling({
      apolloManageClient: { watchQuery: jest.fn().mockReturnValue(statusWatchQuery) } as any,
      apolloLogsClient: { watchQuery: logsClientWatchQuery } as any,
      config: { deployment: 'd1', environment: 'e1', pollingInterval: 1000, deploymentStatus } as any,
      $event: new EventEmitter(),
    });
    return { instance, statusWatchQuery, logsWatchQuery, fallbackWatchQuery, logsClientWatchQuery };
  }

  it('opens with sortDirection desc and no cursor, tailing the newest page like the legacy query did', async () => {
    const { instance, logsClientWatchQuery } = buildInstance();

    await instance.deploymentLogs();

    const { query } = logsClientWatchQuery.mock.calls[0][0].variables;
    expect(query).toEqual({ deploymentUid: 'd1', limit: 5000, sortDirection: 'desc' });
    expect(query).not.toHaveProperty('cursor');
  });

  it('advances by cursor in asc order — never by timestamp', async () => {
    const { instance, statusWatchQuery, logsWatchQuery } = buildInstance(['DEPLOYED']);

    await instance.deploymentLogs();
    statusWatchQuery.emit({ data: { Deployment: { status: 'LIVE' } } });
    await logsWatchQuery.emit({
      data: {
        getDeploymentLogsV2: page([{ message: 'build started', timestamp: '2026-08-06T10:00:00.123Z' }], {
          newestCursor: '[1775462400123,"abc"]',
        }),
      },
    });

    expect(logsWatchQuery.setVariables).toHaveBeenCalledWith({
      query: {
        deploymentUid: 'd1',
        limit: 5000,
        sortDirection: 'asc',
        cursor: '[1775462400123,"abc"]',
      },
    });
  });

  it('does not re-arm when the cursor has not moved, so a repeated page cannot loop forever', async () => {
    const { instance, statusWatchQuery, logsWatchQuery } = buildInstance(['DEPLOYED']);

    await instance.deploymentLogs();
    statusWatchQuery.emit({ data: { Deployment: { status: 'LIVE' } } });
    const samePage = {
      data: {
        getDeploymentLogsV2: page([{ message: 'x', timestamp: '2026-08-06T10:00:00.000Z' }], {
          newestCursor: 'c1',
        }),
      },
    };
    await logsWatchQuery.emit(samePage);
    await logsWatchQuery.emit(samePage);

    expect(logsWatchQuery.setVariables).toHaveBeenCalledTimes(1);
  });

  it('keeps draining past a terminal status while hasNewer reports another page', async () => {
    const { instance, statusWatchQuery, logsWatchQuery } = buildInstance(['DEPLOYED']);

    await instance.deploymentLogs();
    statusWatchQuery.emit({ data: { Deployment: { status: 'DEPLOYED' } } });
    await logsWatchQuery.emit({
      data: { getDeploymentLogsV2: page([{ message: 'a', timestamp: 'x' }], { hasNewer: true, newestCursor: 'c1' }) },
    });

    expect(logsWatchQuery.stopPolling).not.toHaveBeenCalled();

    await logsWatchQuery.emit({
      data: { getDeploymentLogsV2: page([{ message: 'b', timestamp: 'y' }], { hasNewer: false, newestCursor: 'c2' }) },
    });

    expect(logsWatchQuery.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('falls back to the legacy getLogs query when the region has no V2 field', async () => {
    const { instance, logsWatchQuery, fallbackWatchQuery, logsClientWatchQuery } = buildInstance();
    const errors: any[] = [];
    (instance as any).$event.on('deployment-logs', (e: any) => {
      if (e.msgType === 'error') errors.push(e.message);
    });

    await instance.deploymentLogs();
    await logsWatchQuery.emit({
      data: null,
      error: { message: 'Cannot query field "getDeploymentLogsV2" on type "Query".' },
    });

    expect(logsWatchQuery.stopPolling).toHaveBeenCalledTimes(1);
    expect(logsClientWatchQuery).toHaveBeenCalledTimes(2);
    expect(logsClientWatchQuery.mock.calls[1][0].variables).toEqual({ deploymentUid: 'd1' });
    expect(fallbackWatchQuery.subscribe).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
  });

  it('does not demote to the legacy query on a transient network error', async () => {
    const { instance, logsWatchQuery, logsClientWatchQuery } = buildInstance();
    const errors: any[] = [];
    (instance as any).$event.on('deployment-logs', (e: any) => {
      if (e.msgType === 'error') errors.push(e.message);
    });

    await instance.deploymentLogs();
    await logsWatchQuery.emit({ data: null, error: { message: 'Failed to fetch' } });

    expect(logsClientWatchQuery).toHaveBeenCalledTimes(1);
    expect(errors).toContain('Failed to fetch');
  });
});
