import { Errors } from '@oclif/core';

import { EXIT_CANCELLED } from '../../../core/constants';
import { UsageError } from '../../../core/errors';
import * as interruptible from '../../../core/interruptible-ux';
import type { UxLike } from '../../../core/prompt';
import { catalog } from '../../../resources';
import { DeploymentUnsuccessfulError } from '../../../deployments/deployment.errors';
import { DeploymentFollower } from '../../../deployments/deployment.follower';
import { LiveLogFollower } from '../../../logs/live-log.follower';
import type { DeploymentOutcome } from '../../../deployments/deployment.watcher';
import { LaunchApiError } from '../../../transport/errors';
import LogsGet from './get';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');

interface Options {
  resolved?: Record<string, unknown>;
  latest?: unknown;
  get?: () => Promise<unknown>;
  serverLogs?: unknown[];
  serverPages?: unknown[];
  outputIsTTY?: boolean;
}

function commandUnderTest(options: Options = {}) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const latestCalls: unknown[] = [];
  const getCalls: unknown[] = [];
  const walkCalls: unknown[] = [];
  const command = Object.create(LogsGet.prototype) as LogsGet;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1', 'log-type': 'deployment', ...options.resolved },
    services: {
      ux,
      isTTY: false,
      outputIsTTY: options.outputIsTTY ?? false,
      api: {
        deployments: {
          latest: async (params: unknown) => {
            latestCalls.push(params);
            return 'latest' in options ? options.latest : { uid: 'dLatest' };
          },
          get: async (params: unknown) => {
            getCalls.push(params);
            return options.get === undefined ? { uid: 'd1', status: 'LIVE' } : options.get();
          },
        },
        serverLogs: {
          async *pages(params: unknown) {
            walkCalls.push(params);
            yield* options.serverPages ?? [{ logs: options.serverLogs ?? [], pageInfo: { hasNewer: false } }];
          },
        },
      },
    },
  });

  return { command, lines, latestCalls, getCalls, walkCalls };
}

function outcome(kind: DeploymentOutcome['kind'], status: string, deployment: object = {}): DeploymentOutcome {
  return { kind, status, deployment };
}

describe('LogsGet', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('exposes the log type as --type and never as --log-type', () => {
    expect(Object.keys(LogsGet.flags).sort()).toEqual([
      'cursor',
      'deployment',
      'env',
      'org',
      'project',
      'search',
      'since',
      'type',
      'until',
    ]);
    expect(LogsGet.flags.type).toBe(catalog['log-type']);
  });

  it('declares the four server-only rules and the log type input the rules read', () => {
    expect(LogsGet.rules).toHaveLength(4);
    expect(Object.keys(LogsGet.inputs)).toContain('log-type');
  });

  it('T94: follows the live stream of the latest deployment without verifying it again or watching the build', async () => {
    const release = jest.fn();
    jest.spyOn(interruptible, 'onInterrupt').mockReturnValue(release);
    const follow = jest.spyOn(LiveLogFollower.prototype, 'follow').mockResolvedValue(undefined);
    const watch = jest.spyOn(DeploymentFollower.prototype, 'watch');
    const { command, latestCalls, getCalls, walkCalls } = commandUnderTest({ resolved: { 'log-type': 'live' } });

    await command.run();

    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow.mock.calls[0][0]).toEqual({ org: 'org1', project: 'proj1', environment: 'env1', deployment: 'dLatest' });
    expect(follow.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(follow.mock.calls[0][1].aborted).toBe(false);
    expect(latestCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(getCalls).toEqual([]);
    expect(walkCalls).toEqual([]);
    expect(watch).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('verifies a given deployment before following its live stream', async () => {
    jest.spyOn(LiveLogFollower.prototype, 'follow').mockResolvedValue(undefined);
    const { command, latestCalls, getCalls } = commandUnderTest({ resolved: { 'log-type': 'live', deployment: 'd9' } });

    await command.run();

    expect(getCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', deployment: 'd9' }]);
    expect(latestCalls).toEqual([]);
  });

  it('T92: stops a live stream on Ctrl-C with the yellow line and exit 3, then releases the listener', async () => {
    const release = jest.fn();
    let interrupt: () => void = () => undefined;
    jest.spyOn(interruptible, 'onInterrupt').mockImplementation((listener) => {
      interrupt = listener;
      return release;
    });
    jest.spyOn(LiveLogFollower.prototype, 'follow').mockImplementation(
      (_scope, stop) =>
        new Promise((_resolve, reject) => {
          stop.addEventListener('abort', () => reject(stop.reason), { once: true });
          interrupt();
        }),
    );
    const { command, lines } = commandUnderTest({ resolved: { 'log-type': 'live' }, outputIsTTY: true });

    const running = command.run();

    await expect(running).rejects.toMatchObject({ oclif: { exit: EXIT_CANCELLED } });
    expect(lines).toEqual(['\u001b[33mStopped following the logs.\u001b[39m']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('lets a failure of the live stream through and still releases the listener', async () => {
    const release = jest.fn();
    jest.spyOn(interruptible, 'onInterrupt').mockReturnValue(release);
    const failure = new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'gone' }]);
    jest.spyOn(LiveLogFollower.prototype, 'follow').mockRejectedValue(failure);
    const { command, lines } = commandUnderTest({ resolved: { 'log-type': 'live' } });

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing latest deployment with exit 2 for both types', async () => {
    for (const type of ['deployment', 'server']) {
      const { command, walkCalls } = commandUnderTest({ resolved: { 'log-type': type }, latest: undefined });

      await expect(command.run()).rejects.toThrow('No deployments found in this environment.');
      expect(walkCalls).toEqual([]);
    }
  });

  it('verifies a given deployment with a get and never asks for the latest', async () => {
    const { command, latestCalls, getCalls, walkCalls } = commandUnderTest({
      resolved: { 'log-type': 'server', deployment: 'd9' },
    });

    await command.run();

    expect(getCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', deployment: 'd9' }]);
    expect(latestCalls).toEqual([]);
    expect(walkCalls).toEqual([
      {
        org: 'org1',
        project: 'proj1',
        environment: 'env1',
        deployment: 'd9',
        startTime: NOW - 3_600_000,
        endTime: NOW,
      },
    ]);
  });

  it('reads the server logs of the latest deployment when none is given', async () => {
    const { command, latestCalls, getCalls, walkCalls } = commandUnderTest({ resolved: { 'log-type': 'server' } });

    await command.run();

    expect(latestCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(getCalls).toEqual([]);
    expect(walkCalls).toEqual([expect.objectContaining({ deployment: 'dLatest' })]);
  });

  it('turns a not-found verification into the generic exit-2 wording and reads no logs', async () => {
    const missing = new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'raw' }]);
    const { command, walkCalls } = commandUnderTest({
      resolved: { 'log-type': 'server', deployment: 'd9' },
      get: async () => Promise.reject(missing),
    });

    const running = command.run();

    await expect(running).rejects.toThrow(UsageError);
    await expect(running).rejects.toThrow('No deployment with UID "d9" found in this environment.');
    expect(walkCalls).toEqual([]);
  });

  it('propagates a failed verification untouched', async () => {
    const failure = new LaunchApiError(500, [{ code: 'launch.UNKNOWN', message: 'boom' }]);
    const { command } = commandUnderTest({ resolved: { deployment: 'd9' }, get: async () => Promise.reject(failure) });

    await expect(command.run()).rejects.toBe(failure);
  });

  it('walks the server pages with the window, search and cursor and prints every line in order', async () => {
    const { command, lines, walkCalls } = commandUnderTest({
      resolved: { 'log-type': 'server', deployment: 'd9', search: 'timeout', cursor: '[1,"a"]' },
      serverPages: [
        { logs: [{ message: 'one' }, { message: 'two' }], pageInfo: { hasNewer: true, newestCursor: '[2,"b"]' } },
        { logs: [{ message: 'three' }], pageInfo: { hasNewer: false, newestCursor: '[3,"c"]' } },
      ],
    });

    await command.run();

    expect(lines).toEqual(['one', 'two', 'three']);
    expect(walkCalls).toEqual([
      {
        org: 'org1',
        project: 'proj1',
        environment: 'env1',
        deployment: 'd9',
        startTime: NOW - 3_600_000,
        endTime: NOW,
        search: 'timeout',
        cursor: '[1,"a"]',
      },
    ]);
  });

  it('prints the cap notice and a resume command from the last newest cursor when the walk ends with more to read', async () => {
    const { command, lines } = commandUnderTest({
      resolved: { 'log-type': 'server', deployment: 'd9', search: 'time out', since: '2h' },
      serverPages: [
        { logs: [{ message: 'one' }], pageInfo: { hasNewer: true, newestCursor: '[1,"a"]' } },
        { logs: [{ message: 'two' }], pageInfo: { hasNewer: true, newestCursor: '[2,"b"]' } },
      ],
    });

    await command.run();

    expect(lines).toEqual([
      'one',
      'two',
      'Stopped after 100 pages of server logs; more remain in this window.',
      'Resume with: csdx launch:logs:get --org org1 --project proj1 --env env1 --deployment d9 --type server ' +
        `--since 2026-10-28T10:00:00.000Z --until 2026-10-28T12:00:00.000Z --search 'time out' --cursor '[2,"b"]'`,
    ]);
  });

  it('prints a full page of 5000 lines with no cap notice when the server reports nothing newer', async () => {
    const serverLogs = Array.from({ length: 5000 }, (_, index) => ({
      timestamp: '2026-10-28T11:30:00.000Z',
      message: `line ${index}`,
    }));
    const { command, lines } = commandUnderTest({ resolved: { 'log-type': 'server' }, serverLogs });

    await command.run();

    expect(lines).toHaveLength(5000);
    expect(lines[0]).toBe('2026-10-28 11:30:00.000:  line 0');
    expect(lines.at(-1)).toBe('2026-10-28 11:30:00.000:  line 4999');
  });

  it('prints the empty server notice for the resolved window, yellow on a terminal', async () => {
    const { command, lines } = commandUnderTest({ resolved: { 'log-type': 'server' }, outputIsTTY: true });

    await command.run();

    expect(lines).toEqual([
      '\u001b[33mNo server logs found between 2026-10-28T11:00:00.000Z and 2026-10-28T12:00:00.000Z.\u001b[39m',
    ]);
  });

  it('names the search in the empty server notice when nothing matched it', async () => {
    const { command, lines } = commandUnderTest({ resolved: { 'log-type': 'server', search: 'timeout' } });

    await command.run();

    expect(lines).toEqual([
      'No server logs matched "timeout" between 2026-10-28T11:00:00.000Z and 2026-10-28T12:00:00.000Z.',
    ]);
  });

  it('prints the 24 hour notice before the lines and sends the window as the user gave it', async () => {
    const serverLogs = [{ timestamp: '2026-10-27T11:00:00.000Z', message: 'old' }];
    const { command, lines, walkCalls } = commandUnderTest({
      resolved: { 'log-type': 'server', since: '2d' },
      serverLogs,
    });

    await command.run();

    expect(lines).toEqual([
      'Server logs are kept for 24 hours; showing from 2026-10-27T12:00:00.000Z.',
      '2026-10-27 11:00:00.000:  old',
    ]);
    expect(walkCalls).toEqual([expect.objectContaining({ startTime: NOW - 172_800_000, endTime: NOW })]);
  });

  it('prints no notice for a window of exactly 24 hours', async () => {
    const { command, lines } = commandUnderTest({
      resolved: { 'log-type': 'server', since: '24h' },
      serverLogs: [{ message: 'x' }],
    });

    await command.run();

    expect(lines).toEqual(['x']);
  });

  it('rejects a bad window before any read', async () => {
    const { command, walkCalls } = commandUnderTest({ resolved: { 'log-type': 'server', since: 'yesterday' } });

    await expect(command.run()).rejects.toThrow(UsageError);
    expect(walkCalls).toEqual([]);
  });

  it('propagates a failed server read', async () => {
    const failure = new LaunchApiError(500, [{ code: 'launch.UNKNOWN', message: 'boom' }]);
    const { command } = commandUnderTest({ resolved: { 'log-type': 'server' } });
    Object.assign((command as unknown as { services: { api: { serverLogs: object } } }).services.api.serverLogs, {
      async *pages() {
        yield await Promise.reject(failure);
      },
    });

    await expect(command.run()).rejects.toBe(failure);
  });

  it('follows the latest deployment, prints the status line after the lines and releases the listener', async () => {
    const release = jest.fn();
    jest.spyOn(interruptible, 'onInterrupt').mockReturnValue(release);
    const seen: { scope?: unknown; stop?: AbortSignal } = {};
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockImplementation(async function (this: DeploymentFollower, scope, stop) {
      seen.scope = scope;
      seen.stop = stop;
      (this as unknown as { services: { ux: UxLike } }).services.ux.print('a build line');
      return outcome('success', 'LIVE', { deploymentNumber: 4 });
    });
    const { command, lines } = commandUnderTest();

    await command.run();

    expect(seen.scope).toEqual({ org: 'org1', project: 'proj1', environment: 'env1', deployment: 'dLatest' });
    expect(seen.stop?.aborted).toBe(false);
    expect(lines).toEqual(['a build line', 'Deployment #4 is LIVE.']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('prints the empty notice before the status line when the follower printed nothing', async () => {
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockResolvedValue(outcome('failure', 'FAILED', {}));
    const { command, lines } = commandUnderTest({ resolved: { deployment: 'd1' }, outputIsTTY: true });

    await command.run();

    expect(lines).toEqual([
      '\u001b[33mNo deployment logs found for deployment d1.\u001b[39m',
      'Deployment is FAILED.',
    ]);
  });

  it('counts the unavailable notice as output so it never claims there were no logs', async () => {
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockImplementation(async function (this: DeploymentFollower) {
      (this as unknown as { services: { ux: UxLike } }).services.ux.print('  ! Could not read the deployment logs (x).');
      return outcome('success', 'LIVE', { deploymentNumber: 1 });
    });
    const { command, lines } = commandUnderTest();

    await command.run();

    expect(lines).toEqual(['  ! Could not read the deployment logs (x).', 'Deployment #1 is LIVE.']);
  });

  it('exits 1 with the timed-out message and prints no status line when the wait ran out', async () => {
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockResolvedValue(outcome('timed-out', 'DEPLOYING', {}));
    const { command, lines } = commandUnderTest({ resolved: { deployment: 'd1' } });

    const running = command.run();

    await expect(running).rejects.toThrow(DeploymentUnsuccessfulError);
    await expect(running).rejects.toThrow(
      'Stopped waiting after 20 minutes; the deployment was still DEPLOYING. ' +
        'Run csdx launch:logs:get --org org1 --project proj1 --env env1 --deployment d1 again to keep following it.',
    );
    expect(lines).toEqual([]);
  });

  it('stops on Ctrl-C with the yellow line and exit 3, then releases the listener', async () => {
    const release = jest.fn();
    let interrupt: () => void = () => undefined;
    jest.spyOn(interruptible, 'onInterrupt').mockImplementation((listener) => {
      interrupt = listener;
      return release;
    });
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockImplementation(
      (_scope, stop) =>
        new Promise((_resolve, reject) => {
          stop?.addEventListener('abort', () => reject(stop.reason), { once: true });
          interrupt();
        }),
    );
    const { command, lines } = commandUnderTest({ outputIsTTY: true });

    const running = command.run();

    await expect(running).rejects.toBeInstanceOf(Errors.ExitError);
    await expect(running).rejects.toMatchObject({ oclif: { exit: EXIT_CANCELLED } });
    expect(lines).toEqual(['\u001b[33mStopped following the logs.\u001b[39m']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rethrows a failure that is not the interrupt and still releases the listener', async () => {
    const release = jest.fn();
    jest.spyOn(interruptible, 'onInterrupt').mockReturnValue(release);
    const failure = new LaunchApiError(500, [{ code: 'launch.UNKNOWN', message: 'boom' }]);
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockRejectedValue(failure);
    const { command, lines } = commandUnderTest();

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not take the interrupt path for a failure when the signal was aborted with another reason', async () => {
    const release = jest.fn();
    let interrupt: () => void = () => undefined;
    jest.spyOn(interruptible, 'onInterrupt').mockImplementation((listener) => {
      interrupt = listener;
      return release;
    });
    const failure = new LaunchApiError(500, [{ code: 'launch.UNKNOWN', message: 'boom' }]);
    jest.spyOn(DeploymentFollower.prototype, 'watch').mockImplementation(async () => {
      interrupt();
      throw failure;
    });
    const { command, lines } = commandUnderTest();

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('stops the server walk on Ctrl-C after the page in hand, prints a resume command, exits 3 and releases', async () => {
    const release = jest.fn();
    let interrupt: () => void = () => undefined;
    jest.spyOn(interruptible, 'onInterrupt').mockImplementation((listener) => {
      interrupt = listener;
      return release;
    });
    const watch = jest.spyOn(DeploymentFollower.prototype, 'watch');
    const { command, lines } = commandUnderTest({ resolved: { 'log-type': 'server', deployment: 'd9' } });
    let requested = 0;
    Object.assign((command as unknown as { services: { api: { serverLogs: object } } }).services.api.serverLogs, {
      async *pages() {
        requested = 1;
        yield { logs: [{ message: 'one' }], pageInfo: { hasNewer: true, newestCursor: '[1,"a"]' } };
        requested = 2;
        interrupt();
        yield { logs: [{ message: 'two' }], pageInfo: { hasNewer: true, newestCursor: '[2,"b"]' } };
        requested = 3;
        yield { logs: [{ message: 'three' }], pageInfo: { hasNewer: false } };
      },
    });

    const running = command.run();

    await expect(running).rejects.toMatchObject({ oclif: { exit: EXIT_CANCELLED } });
    expect(requested).toBe(2);
    expect(lines).toEqual([
      'one',
      'two',
      'Stopped following the logs.',
      'Resume with: csdx launch:logs:get --org org1 --project proj1 --env env1 --deployment d9 --type server ' +
        `--since 2026-10-28T11:00:00.000Z --until 2026-10-28T12:00:00.000Z --cursor '[2,"b"]'`,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(watch).not.toHaveBeenCalled();
  });
});
