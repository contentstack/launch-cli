import { tmpdir } from 'node:os';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import * as watcher from '../../src/deployments/deployment.watcher';
import listFixture from '../fixtures/deployments-list.json';
import notFoundFixture from '../fixtures/deployment-not-found.json';
import { answerPrompts, stdinReportingTTY, stdoutReportingTTY } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

const realWatchTiming = watcher.defaultWatchTiming;

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'e1f2a3b4c5d6e7f8091a2b3c';
const DEPLOYMENT_UID = 'd1e2f3a4b5c6d7e8f9012345';
const DATA_DIR = tmpdir();
const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const ESCAPE = '\u001b';

const CONFIG: Record<string, unknown> = {
  authorisationType: 'BASIC',
  authtoken: 'test-authtoken',
  email: 'cli-user@example.test',
  region: {
    name: 'integration',
    cma: 'https://cma.integration.test',
    cda: 'https://cda.integration.test',
    uiHost: 'https://app.integration.test',
    launchHubUrl: LAUNCH_HUB_URL,
  },
};

const DEPLOYMENTS = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments`;
const DEPLOYMENT_PATH = `${DEPLOYMENTS}/${DEPLOYMENT_UID}`;
const BUILD_LOGS = `/logs/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments/${DEPLOYMENT_UID}/logs/deployment-logs`;
const SERVER_LOGS = `/logs/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments/${DEPLOYMENT_UID}/logs/server-logs`;

const LINE_ONE = { message: 'Installing dependencies...', timestamp: '2026-10-28T10:00:00.000Z', stage: 'INSTALL' };
const LINE_TWO = { message: 'Build complete', timestamp: '2026-10-28T10:00:05.000Z', stage: 'BUILD' };
const LINE_THREE = { message: 'Deploying', timestamp: '2026-10-28T10:00:09.000Z', stage: 'DEPLOY' };

let config: Interfaces.Config;
let onWire: string[];

function recordWire(): void {
  onWire = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

function hub(): nock.Scope {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

function ownedProject(): nock.Scope {
  return projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
}

function getArgs(...extra: string[]): string[] {
  return [
    'launch:logs:get',
    '--org',
    ORG_UID,
    '--project',
    PROJECT_UID,
    '--env',
    ENV_UID,
    ...extra,
    '--data-dir',
    DATA_DIR,
  ];
}

function deploymentGet(status: string, extra: Record<string, unknown> = {}): nock.Scope {
  return hub()
    .get(DEPLOYMENT_PATH)
    .reply(200, { deployment: { uid: DEPLOYMENT_UID, deploymentNumber: 4, status, ...extra } });
}

function buildLogs(lines: unknown[]): nock.Scope {
  return hub().get(BUILD_LOGS).query(true).reply(200, { deploymentLogs: lines });
}

function serverLogs(window: { startTime: number; endTime: number }, entries: unknown[]): nock.Scope {
  return hub()
    .get(SERVER_LOGS)
    .query({ startTime: String(window.startTime), endTime: String(window.endTime) })
    .reply(200, { serverLogs: entries });
}

function outputLines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line !== '');
}

function timeouts(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
}

describe('integration: launch:logs:get on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    recordWire();
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => ({
      ...realWatchTiming(),
      sleep: async () => undefined,
    }));
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('T40: prints the build lines then the status line of a finished LIVE deployment on a pipe, exit 0', async () => {
    ownedProject();
    const verify = deploymentGet('LIVE');
    const poll = deploymentGet('LIVE');
    const first = buildLogs([LINE_ONE, LINE_TWO]);
    const drain = buildLogs([]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout)).toEqual([
      '2026-10-28 10:00:00.000:  Installing dependencies...',
      '2026-10-28 10:00:05.000:  Build complete',
      'Deployment #4 is LIVE.',
    ]);
    expect(stdout).not.toContain(ESCAPE);
    expect([verify, poll, first, drain].every((scope) => scope.isDone())).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
    expect(onWire).toEqual([]);
  });

  it('T41: follows the latest deployment when --deployment is absent, with limit=1 and no prompt', async () => {
    ownedProject();
    const answered = answerPrompts({});
    const restoreStdin = stdinReportingTTY(true);
    const latest = hub()
      .get(DEPLOYMENTS)
      .query({ limit: '1', skip: '0' })
      .reply(200, { ...listFixture, deployments: [{ uid: DEPLOYMENT_UID, deploymentNumber: 4, status: 'LIVE' }] });
    const other = hub().get(DEPLOYMENTS).query({ limit: '100', skip: '0' }).reply(200, listFixture);
    deploymentGet('LIVE');
    buildLogs([LINE_ONE]);
    buildLogs([]);

    try {
      const { error, stdout } = await runCommand(getArgs(), config);

      expect(error).toBeUndefined();
      expect(latest.isDone()).toBe(true);
      expect(other.isDone()).toBe(false);
      expect(outputLines(stdout)).toEqual(['2026-10-28 10:00:00.000:  Installing dependencies...', 'Deployment #4 is LIVE.']);
      expect(answered.messages).toEqual([]);
      expect(cliux.inquire).not.toHaveBeenCalled();
      expect(onWire).toEqual([]);
    } finally {
      restoreStdin();
    }
  });

  it('T41: exits 2 when the environment has no deployment, for either type, and reads no logs', async () => {
    for (const type of ['deployment', 'server']) {
      ownedProject();
      hub().get(DEPLOYMENTS).query({ limit: '1', skip: '0' }).reply(200, { ...listFixture, deployments: [] });
      const logs = hub().get(BUILD_LOGS).query(true).reply(200, { deploymentLogs: [] });

      const { error } = await runCommand(getArgs('--type', type), config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toBe('No deployments found in this environment.');
      expect(logs.isDone()).toBe(false);
      nock.cleanAll();
    }

    expect(onWire).toEqual([]);
  });

  it.each(['FAILED', 'CANCELLED'])('T42: prints the lines and the status line of a %s deployment, exit 0, no failure hint', async (status) => {
    ownedProject();
    deploymentGet(status);
    deploymentGet(status);
    buildLogs([LINE_ONE]);
    buildLogs([]);

    const { error, stdout, stderr } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout)).toEqual(['2026-10-28 10:00:00.000:  Installing dependencies...', `Deployment #4 is ${status}.`]);
    expect(stdout).not.toContain('did not succeed');
    expect(stdout).not.toContain('csdx launch:');
    expect(stderr).toBe('');
    expect(onWire).toEqual([]);
  });

  it('T43: prints each line of an in-flight deployment once, in order, with no escape codes on a pipe', async () => {
    ownedProject();
    deploymentGet('QUEUED');
    deploymentGet('QUEUED');
    buildLogs([]);
    deploymentGet('DEPLOYING');
    buildLogs([LINE_ONE, LINE_TWO]);
    deploymentGet('LIVE');
    buildLogs([LINE_THREE]);
    buildLogs([]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout)).toEqual([
      '2026-10-28 10:00:00.000:  Installing dependencies...',
      '2026-10-28 10:00:05.000:  Build complete',
      '2026-10-28 10:00:09.000:  Deploying',
      'Deployment #4 is LIVE.',
    ]);
    expect(stdout).not.toContain(ESCAPE);
    expect(nock.pendingMocks()).toEqual([]);
    expect(onWire).toEqual([]);
  });

  it('T44: prints the yellow no-logs line then the status line on a terminal', async () => {
    const restoreStdout = stdoutReportingTTY(true);

    try {
      ownedProject();
      deploymentGet('LIVE');
      deploymentGet('LIVE');
      buildLogs([]);

      const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config, { stripAnsi: false });

      expect(error).toBeUndefined();
      expect(outputLines(stdout)).toEqual([
        `${ESCAPE}[33mNo deployment logs found for deployment ${DEPLOYMENT_UID}.${ESCAPE}[39m`,
        'Deployment #4 is LIVE.',
      ]);
    } finally {
      restoreStdout();
    }
  });

  it('T44: prints the no-logs line plain on a pipe', async () => {
    ownedProject();
    deploymentGet('LIVE');
    deploymentGet('LIVE');
    buildLogs([]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout)).toEqual([
      `No deployment logs found for deployment ${DEPLOYMENT_UID}.`,
      'Deployment #4 is LIVE.',
    ]);
  });

  it.each([
    [{ deploymentNumber: 7 }, 'Deployment #7 is LIVE.'],
    [{ deploymentNumber: 0 }, 'Deployment #0 is LIVE.'],
    [{ deploymentNumber: null }, 'Deployment is LIVE.'],
    [{ deploymentNumber: undefined }, 'Deployment is LIVE.'],
  ])('T45: words the status line for %j', async (extra, line) => {
    ownedProject();
    deploymentGet('LIVE', extra);
    deploymentGet('LIVE', extra);
    buildLogs([LINE_ONE]);
    buildLogs([]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout).at(-1)).toBe(line);
  });

  it('T46: exits 1 with the timed-out message when the deployment stays DEPLOYING past 20 minutes', async () => {
    let clock = NOW;
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => ({
      ...realWatchTiming(),
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    }));
    ownedProject();
    hub().get(DEPLOYMENT_PATH).times(500).reply(200, { deployment: { uid: DEPLOYMENT_UID, status: 'DEPLOYING' } });
    hub().get(BUILD_LOGS).query(true).times(500).reply(200, { deploymentLogs: [] });

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(
      'Stopped waiting after 20 minutes; the deployment was still DEPLOYING. ' +
        `Run csdx launch:logs:get --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID} ` +
        `--deployment ${DEPLOYMENT_UID} again to keep following it.`,
    );
    expect(clock - NOW).toBeGreaterThan(0);
    expect(clock - NOW).toBeLessThanOrEqual(20 * 60 * 1000);
    expect(stdout).not.toContain('is DEPLOYING');
    expect(onWire).toEqual([]);
  });

  it('T47: stops on Ctrl-C with the yellow line and exit 3, no Error line, no extra poll, nothing left behind', async () => {
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => realWatchTiming());
    const restoreStdout = stdoutReportingTTY(true);
    jest.spyOn(cliux, 'loaderV2').mockReturnValue(undefined as never);
    const listenersBefore = process.listenerCount('SIGINT');
    const timersBefore = timeouts();
    let statusReads = 0;
    let logReads = 0;

    try {
      ownedProject();
      hub()
        .get(DEPLOYMENT_PATH)
        .times(5)
        .reply(200, () => {
          statusReads += 1;
          return { deployment: { uid: DEPLOYMENT_UID, deploymentNumber: 4, status: 'DEPLOYING' } };
        });
      hub()
        .get(BUILD_LOGS)
        .query(true)
        .times(5)
        .reply(200, () => {
          logReads += 1;
          setImmediate(() => process.emit('SIGINT'));
          return { deploymentLogs: [LINE_ONE] };
        });

      const { error, stdout, stderr } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config, {
        stripAnsi: false,
      });

      expect(error?.oclif?.exit).toBe(3);
      expect(stdout).toContain(`${ESCAPE}[33mStopped following the logs.${ESCAPE}[39m`);
      expect(stderr).not.toContain('error');
      expect(error?.message).not.toContain('Error');
      expect(statusReads).toBe(2);
      expect(logReads).toBe(1);
      expect(process.listenerCount('SIGINT')).toBe(listenersBefore);
      expect(timeouts()).toBe(timersBefore);
    } finally {
      restoreStdout();
    }
  });

  it('T47: prints the interrupt line plain on a pipe', async () => {
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => realWatchTiming());
    ownedProject();
    hub().get(DEPLOYMENT_PATH).times(5).reply(200, { deployment: { uid: DEPLOYMENT_UID, status: 'DEPLOYING' } });
    hub()
      .get(BUILD_LOGS)
      .query(true)
      .times(5)
      .reply(200, () => {
        setImmediate(() => process.emit('SIGINT'));
        return { deploymentLogs: [] };
      });

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(3);
    expect(outputLines(stdout)).toEqual(['Stopped following the logs.']);
  });

  it('T48: prints the unavailable notice once and still the status line when the log read fails', async () => {
    ownedProject();
    deploymentGet('LIVE');
    deploymentGet('LIVE');
    hub()
      .get(BUILD_LOGS)
      .query(true)
      .reply(500, { errors: [{ code: 'launch.UNKNOWN', message: 'logs are down' }] });

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error).toBeUndefined();
    expect(stdout.split('Could not read the deployment logs').length - 1).toBe(1);
    expect(stdout).not.toContain('No deployment logs found');
    expect(outputLines(stdout).at(-1)).toBe('Deployment #4 is LIVE.');
    expect(onWire).toEqual([]);
  });

  it('T49: exits 2 with the generic not-found wording and requests no logs for a deployment that is not here', async () => {
    ownedProject();
    hub().get(DEPLOYMENT_PATH).reply(404, notFoundFixture);
    const logs = hub().get(BUILD_LOGS).query(true).reply(200, { deploymentLogs: [] });

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No deployment with UID "${DEPLOYMENT_UID}" found in this environment.`);
    expect(error?.message).not.toContain(ENV_UID);
    expect(stdout).toBe('');
    expect(logs.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T49: exits 2 for the same foreign deployment with --type server and reads no server logs', async () => {
    ownedProject();
    hub().get(DEPLOYMENT_PATH).reply(404, notFoundFixture);
    const logs = hub().get(SERVER_LOGS).query(true).reply(200, { serverLogs: [] });

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No deployment with UID "${DEPLOYMENT_UID}" found in this environment.`);
    expect(logs.isDone()).toBe(false);
  });

  it('T49: exits with a malformed-response error when the deployment comes back as null and reads no logs', async () => {
    ownedProject();
    hub().get(DEPLOYMENT_PATH).reply(200, { deployment: null });
    const logs = hub().get(BUILD_LOGS).query(true).reply(200, { deploymentLogs: [] });

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('deployment response');
    expect(logs.isDone()).toBe(false);
  });

  it.each([
    [true, true],
    [false, false],
  ])('T50: exits 1 on a status GET 500, red on stdout TTY=%s', async (tty) => {
    const restoreStdout = stdoutReportingTTY(tty);

    try {
      ownedProject();
      hub()
        .get(DEPLOYMENT_PATH)
        .reply(500, { errors: [{ code: 'launch.UNKNOWN', message: 'boom' }] });
      const logs = hub().get(BUILD_LOGS).query(true).reply(200, { deploymentLogs: [] });

      const { error, stderr } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID), config, { stripAnsi: false });

      expect(error?.oclif?.exit).toBe(1);
      expect(stderr).toContain('error: boom');
      expect(stderr.includes(`${ESCAPE}[31m`)).toBe(tty);
      expect(logs.isDone()).toBe(false);
    } finally {
      restoreStdout();
    }
  });

  it('T51: reads the window from the server-logs route with exact milliseconds and prints plain lines', async () => {
    const startTime = Date.parse('2026-10-28T09:00:00Z');
    const endTime = Date.parse('2026-10-28T15:30:00+05:30');
    ownedProject();
    deploymentGet('LIVE');
    const read = hub()
      .get(SERVER_LOGS)
      .query({ startTime: String(startTime), endTime: String(endTime) })
      .reply(200, {
        serverLogs: [
          { timestamp: '2026-10-28T09:15:00.123Z', message: 'GET /index 200', source: 'edge-fn-source' },
          { timestamp: '2026-10-28T09:16:00.000Z', message: `${ESCAPE}[31mboom${ESCAPE}[0m`, source: 'edge-fn-source' },
        ],
      });

    const { error, stdout } = await runCommand(
      getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server', '--since', '2026-10-28T09:00:00Z', '--until', '2026-10-28T15:30:00+05:30'),
      config,
    );

    expect(error).toBeUndefined();
    expect(read.isDone()).toBe(true);
    expect(outputLines(stdout)).toEqual(['2026-10-28 09:15:00.123:  GET /index 200', '2026-10-28 09:16:00.000:  boom']);
    expect(stdout).not.toContain('edge-fn-source');
    expect(stdout).not.toContain(ESCAPE);
    expect(onWire).toEqual([]);
  });

  it('T52: defaults the window to the last hour on the wire', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ownedProject();
    deploymentGet('LIVE');
    const read = serverLogs({ startTime: NOW - 3_600_000, endTime: NOW }, [{ timestamp: '2026-10-28T11:30:00.000Z', message: 'hi' }]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

    expect(error).toBeUndefined();
    expect(read.isDone()).toBe(true);
    expect(outputLines(stdout)).toEqual(['2026-10-28 11:30:00.000:  hi']);
    expect(onWire).toEqual([]);
  });

  it('T53: prints the yellow no-server-logs line for the resolved window and exits 0', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const restoreStdout = stdoutReportingTTY(true);

    try {
      ownedProject();
      deploymentGet('LIVE');
      serverLogs({ startTime: NOW - 3_600_000, endTime: NOW }, []);

      const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config, {
        stripAnsi: false,
      });

      expect(error).toBeUndefined();
      expect(outputLines(stdout)).toEqual([
        `${ESCAPE}[33mNo server logs found between 2026-10-28T11:00:00.000Z and 2026-10-28T12:00:00.000Z.${ESCAPE}[39m`,
      ]);
    } finally {
      restoreStdout();
    }
  });

  it('T53: prints the no-server-logs line plain on a pipe', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ownedProject();
    deploymentGet('LIVE');
    serverLogs({ startTime: NOW - 3_600_000, endTime: NOW }, []);

    const { stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

    expect(outputLines(stdout)).toEqual([
      'No server logs found between 2026-10-28T11:00:00.000Z and 2026-10-28T12:00:00.000Z.',
    ]);
  });

  it.each([
    [5000, true],
    [4999, false],
  ])('T54: with %i server lines the cap notice shows is %s', async (count, shows) => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ownedProject();
    deploymentGet('LIVE');
    serverLogs(
      { startTime: NOW - 3_600_000, endTime: NOW },
      Array.from({ length: count }, (_, index) => ({ timestamp: '2026-10-28T11:30:00.000Z', message: `line ${index}` })),
    );

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);
    const lines = outputLines(stdout);

    expect(error).toBeUndefined();
    expect(lines).toHaveLength(shows ? count + 1 : count);
    expect(lines.at(-1)).toBe(
      shows
        ? 'Showing the newest 5000 server log lines in this window. Narrow --since/--until to see earlier ones.'
        : `2026-10-28 11:30:00.000:  line ${count - 1}`,
    );
  });

  it('T55: prints the 24 hour notice first for --since 2d and sends the user own start time', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ownedProject();
    deploymentGet('LIVE');
    serverLogs({ startTime: NOW - 172_800_000, endTime: NOW }, [{ timestamp: '2026-10-27T13:00:00.000Z', message: 'old' }]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server', '--since', '2d'), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout)).toEqual([
      'Server logs are kept for 24 hours; showing from 2026-10-27T12:00:00.000Z.',
      '2026-10-27 13:00:00.000:  old',
    ]);
  });

  it('T55: prints no notice for --since 24h', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ownedProject();
    deploymentGet('LIVE');
    serverLogs({ startTime: NOW - 86_400_000, endTime: NOW }, [{ timestamp: '2026-10-27T13:00:00.000Z', message: 'old' }]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server', '--since', '24h'), config);

    expect(error).toBeUndefined();
    expect(outputLines(stdout)).toEqual(['2026-10-27 13:00:00.000:  old']);
  });

  it('T56: exits 1 when the server-logs body has no serverLogs array', async () => {
    ownedProject();
    deploymentGet('LIVE');
    hub().get(SERVER_LOGS).query(true).reply(200, { logs: [] });

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('The Launch API returned a server log page without a serverLogs array.');
  });

  it.each([
    [400, 'launch.SERVERLOGS.NOT_INTEGER', 'The Launch API could not read the time window of the server logs.'],
    [
      408,
      'launch.LOGS.QUERY_TIMEOUT',
      'The server logs query took too long. Narrow the window with --since and --until and try again.',
    ],
    [
      408,
      'launch.LOGS.REQUEST_TIMEOUT',
      'The Launch API took too long to answer. Try again, or narrow the window with --since and --until.',
    ],
    [404, 'launch.PROJECT.NOT_FOUND', 'No project found with that UID.'],
    [404, 'launch.DEPLOYMENT.NOT_FOUND', 'No deployment found with that UID.'],
    [400, 'launch.DEPLOYMENT.PROJECT_MISMATCH', 'That deployment does not belong to this project.'],
    [400, 'launch.DEPLOYMENT.ENVIRONMENT_MISMATCH', 'That deployment does not belong to this environment.'],
  ])('T57: words a %i %s answer from the server logs in the CLI own words, exit 1', async (status, code, wording) => {
    ownedProject();
    deploymentGet('LIVE');
    hub()
      .get(SERVER_LOGS)
      .query(true)
      .times(4)
      .reply(status, { errors: [{ code, message: 'raw server text' }], status });

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(wording);
    expect(error?.message).not.toContain('raw server text');
    expect(onWire).toEqual([]);
  }, 20_000);

  it('T58: prints a fallback for server entries missing their timestamp, message or everything', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ownedProject();
    deploymentGet('LIVE');
    serverLogs({ startTime: NOW - 3_600_000, endTime: NOW }, [
      {},
      { message: 'no time' },
      { timestamp: '2026-10-28T11:00:00.000Z' },
      { timestamp: Date.parse('2026-10-28T11:00:01.000Z'), message: 'epoch' },
      null,
    ]);

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

    expect(error).toBeUndefined();
    expect(stdout.split('\n')).toEqual(['', 'no time', '2026-10-28 11:00:00.000:', '2026-10-28 11:00:01.000:  epoch', '', '']);
  });

  it('T59: a server run registers no SIGINT handler and starts no spinner', async () => {
    const restoreStdout = stdoutReportingTTY(true);
    const loader = jest.spyOn(cliux, 'loaderV2');
    const baseline = process.listenerCount('SIGINT');
    let during = -1;

    try {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      ownedProject();
      deploymentGet('LIVE');
      hub()
        .get(SERVER_LOGS)
        .query(true)
        .reply(200, () => {
          during = process.listenerCount('SIGINT');
          return { serverLogs: [{ timestamp: '2026-10-28T11:30:00.000Z', message: 'hi' }] };
        });

      const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'server'), config);

      expect(error).toBeUndefined();
      expect(during).toBe(baseline);
      expect(process.listenerCount('SIGINT')).toBe(baseline);
      expect(loader).not.toHaveBeenCalled();
    } finally {
      restoreStdout();
    }
  });

  it('T60: exits 2 naming --type for an unknown type and puts nothing on the wire', async () => {
    const ownership = ownedProject();
    const verify = deploymentGet('LIVE');

    const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'build'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('--type must be one of deployment, server, live; "build" is not.');
    expect(stdout).toBe('');
    expect(ownership.isDone()).toBe(false);
    expect(verify.isDone()).toBe(false);
    expect(nock.pendingMocks()).toHaveLength(2);
    expect(onWire).toEqual([]);
  });

  it('T60: accepts --type SERVER in any case and never asks for a project type on a terminal', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const answered = answerPrompts({});
    const restoreStdin = stdinReportingTTY(true);
    ownedProject();
    deploymentGet('LIVE');
    const read = serverLogs({ startTime: NOW - 3_600_000, endTime: NOW }, [{ message: 'upper' }]);

    try {
      const { error, stdout } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'SERVER'), config);

      expect(error).toBeUndefined();
      expect(read.isDone()).toBe(true);
      expect(outputLines(stdout)).toEqual(['upper']);
      expect(answered.messages).toEqual([]);
    } finally {
      restoreStdin();
    }
  });

  it('T60: refuses --type live as not available yet, with exit 2 and no deployment or log request', async () => {
    ownedProject();
    const verify = deploymentGet('LIVE');

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, '--type', 'live'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('--type live is not available yet');
    expect(verify.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it.each([
    [['--since', '1h'], '--since is only supported when --type is one of server; --type is deployment.'],
    [['--until', '1h', '--type', 'live'], '--until is only supported when --type is one of server; --type is live.'],
    [['--since', '12hr', '--until', '2026-10-28T10:00:00Z', '--type', 'server'], '--since and --until must both be relative (like 12hr) or both absolute (ISO 8601) timestamps.'],
    [['--since', '30m', '--until', '2h', '--type', 'server'], '--since must not be later than --until.'],
  ])('T61: exits 2 for %j with nothing read', async (flags, message) => {
    ownedProject();
    const verify = deploymentGet('LIVE');
    const logs = hub().get(SERVER_LOGS).query(true).reply(200, { serverLogs: [] });

    const { error } = await runCommand(getArgs('--deployment', DEPLOYMENT_UID, ...flags), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(message);
    expect(verify.isDone()).toBe(false);
    expect(logs.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T62: exits 2 naming --env when it is missing and there is no terminal', async () => {
    ownedProject();
    const { error } = await runCommand(
      ['launch:logs:get', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--env');
    expect(onWire).toEqual([]);
  });
});
