import { tmpdir } from 'node:os';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import * as watcher from '../../src/deployments/deployment.watcher';
import getFixture from '../fixtures/deployment-get.json';
import notFoundFixture from '../fixtures/deployment-not-found.json';
import { CTRL_C, answerPrompts, onTerminal, pretendTerminal } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'e1f2a3b4c5d6e7f8091a2b3c';
const DEPLOYMENT_UID = 'd1e2f3a4b5c6d7e8f9012345';
const DATA_DIR = tmpdir();

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
const QUESTION = `Are you sure you want to roll back this environment to deployment "${DEPLOYMENT_UID}"?`;
const POST_PENDING = `POST ${LAUNCH_HUB_URL}:443${DEPLOYMENTS}/rollback`;

const realWatchTiming = watcher.defaultWatchTiming;
const STARTED = (uid: string): string => `Rollback to deployment "${uid}" started.\n`;
const SUCCESS = (uid: string): string => `✔ Environment rolled back to deployment "${uid}" successfully.\n`;

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

function args(...extra: string[]): string[] {
  return [
    'launch:deployments:rollback',
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

const OLDER_UID = 'c0d1e2f3a4b5c6d7e8f90123';
const RUNNING_UID = 'f1e2d3c4b5a60718293a4b5c';
const QUEUED_UID = 'f2e2d3c4b5a60718293a4b5c';
const LISTED = {
  pagination: { count: 4, limit: 100 },
  deployments: [
    { uid: RUNNING_UID, status: 'DEPLOYING', deploymentNumber: 5, commitHash: '1234567aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { uid: QUEUED_UID, status: 'QUEUED' },
    { uid: DEPLOYMENT_UID, status: 'LIVE', commitHash: '9fceb02d0ae598e95dc970b74767f19372d61af8' },
    { uid: OLDER_UID, status: 'FAILED', createdAt: '2025-11-06T07:39:19.230Z' },
  ],
};

function listing(page: unknown = LISTED): nock.Scope {
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);

  return hub().get(DEPLOYMENTS).query({ limit: 100, skip: 0, rollbackEligible: 'true' }).reply(200, page as nock.Body);
}

function followUp(uid: string, statuses: string[]): nock.Scope[] {
  return statuses.map((status) =>
    hub().get(`${DEPLOYMENTS}/${uid}`).reply(200, { deployment: { uid, status } }),
  );
}

function lookup(): nock.Scope {
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);

  return hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(200, getFixture);
}

describe('integration: launch:deployments:rollback on the wire', () => {
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

  it('looks the deployment up, then posts the rollback with the reason as JSON, when --yes is given', async () => {
    const order: string[] = [];
    const found = lookup();
    found.on('replied', () => order.push('lookup'));
    const prompts = answerPrompts({});
    const rollback = hub()
      .post(`${DEPLOYMENTS}/rollback`, { deployment: DEPLOYMENT_UID, reason: 'bad release' })
      .matchHeader('content-type', /application\/json/)
      .reply(200, { deployment: getFixture.deployment }, undefined);
    rollback.on('replied', () => order.push('rollback'));
    const [live] = followUp(DEPLOYMENT_UID, ['LIVE']);
    live.on('replied', () => order.push('poll'));

    const { error, stdout } = await runCommand(
      args('--deployment', DEPLOYMENT_UID, '--reason', '"bad release"', '--yes'),
      config,
    );

    expect(error).toBeUndefined();
    expect(order).toEqual(['lookup', 'rollback', 'poll']);
    expect(rollback.isDone()).toBe(true);
    expect(prompts.messages).toEqual([]);
    expect(stdout).toBe(`${STARTED(DEPLOYMENT_UID)}${SUCCESS(DEPLOYMENT_UID)}`);
    expect(onWire).toEqual([]);
  });

  it('sends no reason key when --reason is absent, empty or whitespace', async () => {
    const bodies: unknown[] = [];

    for (const extra of [[], ['--reason', '""'], ['--reason', '"   "']]) {
      lookup();
      hub()
        .post(`${DEPLOYMENTS}/rollback`, (body: unknown) => {
          bodies.push(body);
          return true;
        })
        .reply(200, {});
      followUp(DEPLOYMENT_UID, ['LIVE']);

      const { error } = await runCommand(args('--deployment', DEPLOYMENT_UID, ...extra, '--yes'), config);

      expect(error).toBeUndefined();
    }

    expect(bodies).toEqual([
      { deployment: DEPLOYMENT_UID },
      { deployment: DEPLOYMENT_UID },
      { deployment: DEPLOYMENT_UID },
    ]);
    expect(onWire).toEqual([]);
  });

  it('says the deployment was not rolled back, exits 3 and never posts when the user declines', async () => {
    const found = lookup();
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const restore = pretendTerminal();
    const inquired: unknown[] = [];
    jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
      inquired.push(payload);
      return false as never;
    });

    try {
      const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID), config);

      expect(error?.oclif?.exit).toBe(3);
      expect(stdout).toBe('Environment not rolled back.\n');
      expect(inquired).toEqual([{ type: 'confirm', name: 'confirm', message: QUESTION, default: false }]);
      expect(onWire).toEqual([]);
      expect(found.isDone()).toBe(true);
      expect(rollback.isDone()).toBe(false);
      expect(nock.pendingMocks()).toEqual([POST_PENDING]);
    } finally {
      restore();
    }
  });

  it('exits 2 naming --yes, and never posts, without a terminal and without --yes', async () => {
    const found = lookup();
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});

    const { error } = await runCommand(args('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${QUESTION} Pass --yes to confirm without an interactive terminal.`);
    expect(onWire).toEqual([]);
    expect(found.isDone()).toBe(true);
    expect(rollback.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual([POST_PENDING]);
  });

  it('exits 3 and never posts when Ctrl-C is pressed at the confirmation', async () => {
    const found = lookup();
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const prompts = answerPrompts({ [QUESTION]: CTRL_C });

    const { error } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
    expect(prompts.messages).toEqual([QUESTION]);
    expect(found.isDone()).toBe(true);
    expect(rollback.isDone()).toBe(false);
    expect(onWire).toEqual([]);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('posts exactly once and exits 0 when the user says yes at the prompt', async () => {
    const found = lookup();
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).once().reply(200, {});
    followUp(DEPLOYMENT_UID, ['LIVE']);
    const prompts = answerPrompts({ [QUESTION]: true });

    const { error, stdout } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([QUESTION]);
    expect(found.isDone()).toBe(true);
    expect(rollback.isDone()).toBe(true);
    expect(stdout).toBe(`${STARTED(DEPLOYMENT_UID)}${SUCCESS(DEPLOYMENT_UID)}`);
    expect(onWire).toEqual([]);
  });

  it('waits for the target to become LIVE, whatever status it starts in, and only then reports the success', async () => {
    lookup();
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const polls = followUp(DEPLOYMENT_UID, ['ARCHIVED', 'DEPLOYED', 'LIVE']);

    const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error).toBeUndefined();
    expect(rollback.isDone()).toBe(true);
    expect(polls.every((scope) => scope.isDone())).toBe(true);
    expect(stdout).toBe(`${STARTED(DEPLOYMENT_UID)}${SUCCESS(DEPLOYMENT_UID)}`);
    expect(onWire).toEqual([]);
  });

  it('exits 1 pointing at deployments:get, and never claims success, when the target is still not LIVE as the wait ends', async () => {
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => ({
      ...realWatchTiming(),
      sleep: async () => undefined,
      timeoutMs: 1,
    }));
    lookup();
    hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    followUp(DEPLOYMENT_UID, ['ARCHIVED']);

    const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(
      `Deployment "${DEPLOYMENT_UID}" was still ARCHIVED when the CLI stopped waiting. ` +
        `Run csdx launch:deployments:get --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID} ` +
        `--deployment ${DEPLOYMENT_UID} to check whether the rollback completed.`,
    );
    expect(stdout).toBe(STARTED(DEPLOYMENT_UID));
    expect(stdout).not.toContain('successfully');
    expect(onWire).toEqual([]);
  });

  it('exits 1 pointing at deployments:get, and never claims success, when the status poll keeps failing', async () => {
    lookup();
    hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const polls = [1, 2, 3].map(() =>
      hub()
        .get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`)
        .reply(500, { errors: [{ code: 'launch.SERVER.ERROR', message: 'boom' }], status: 500 }),
    );

    const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain(`The rollback to deployment "${DEPLOYMENT_UID}" could not be confirmed`);
    expect(error?.message).toContain(`csdx launch:deployments:get --org ${ORG_UID}`);
    expect(error?.message).toContain(`--deployment ${DEPLOYMENT_UID}`);
    expect(polls.every((scope) => scope.isDone())).toBe(true);
    expect(stdout).toBe(STARTED(DEPLOYMENT_UID));
    expect(stdout).not.toContain('successfully');
    expect(onWire).toEqual([]);
  });

  it('stops waiting on Ctrl-C, exits 3 saying the rollback continues on Launch, and never claims success', async () => {
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => ({
      ...realWatchTiming(),
      sleep: async () => {
        process.emit('SIGINT');
      },
    }));
    lookup();
    hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const [first, second] = followUp(DEPLOYMENT_UID, ['ARCHIVED', 'LIVE']);

    const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe(
      `Stopped waiting. The rollback to deployment "${DEPLOYMENT_UID}" was not cancelled and continues on Launch. ` +
        `Check it with csdx launch:deployments:get --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID} ` +
        `--deployment ${DEPLOYMENT_UID}.`,
    );
    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(false);
    expect(stdout).toBe(STARTED(DEPLOYMENT_UID));
    expect(process.listenerCount('SIGINT')).toBe(0);
    expect(onWire).toEqual([]);
  });

  it('reports the generic not-found wording, exit 2, with no prompt and no post, for an unknown deployment', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const found = hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(404, notFoundFixture);
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No deployment with UID "${DEPLOYMENT_UID}" found in this environment.`);
    expect(prompts.messages).toEqual([]);
    expect(found.isDone()).toBe(true);
    expect(rollback.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual([POST_PENDING]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming --deployment and sends nothing when it is omitted, empty or whitespace', async () => {
    for (const extra of [[], ['--deployment', '""'], ['--deployment', '"   "']]) {
      projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
      const { error } = await runCommand(args(...extra, '--yes'), config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toContain('Missing required value for --deployment');
    }

    expect(onWire).toEqual([]);
  });

  it.each([
    ['launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE', 409, 'This deployment is not eligible for rollback. Choose a deployment that was live earlier.'],
    ['launch.DEPLOYMENT.NO_LIVE_DEPLOYMENT_FOUND', 409, 'This environment has no live deployment, so a rollback is not possible.'],
  ])('exits 1 with readable wording when the rollback is refused with %s', async (code, status, message) => {
    lookup();
    hub()
      .post(`${DEPLOYMENTS}/rollback`)
      .reply(status, { errors: [{ code, message: 'raw' }], status });

    const { error } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(message);
    expect(onWire).toEqual([]);
  });

  it('offers the rollback-eligible deployments newest first, without the live one, at a terminal when --deployment is omitted, then confirms and rolls back to the chosen full uid', async () => {
    const listed = listing();
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const found = hub().get(`${DEPLOYMENTS}/${OLDER_UID}`).reply(200, { deployment: { uid: OLDER_UID, status: 'FAILED' } });
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`, { deployment: OLDER_UID }).reply(200, {});
    followUp(OLDER_UID, ['LIVE']);
    const question = `Are you sure you want to roll back this environment to deployment "${OLDER_UID}"?`;
    const prompts = answerPrompts({ 'Choose a deployment for rollback': OLDER_UID, [question]: true });

    const { error, stdout } = await onTerminal(() => runCommand(args(), config));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual(['Choose a deployment for rollback', question]);
    expect(prompts.payloads[0]).toMatchObject({
      type: 'list',
      choices: [
        { name: `#5  ${RUNNING_UID}  DEPLOYING  1234567`, value: RUNNING_UID },
        { name: `${QUEUED_UID}  QUEUED`, value: QUEUED_UID },
        { name: `${OLDER_UID}  FAILED  2025-11-06T07:39:19.230Z`, value: OLDER_UID },
      ],
    });
    expect(listed.isDone()).toBe(true);
    expect(found.isDone()).toBe(true);
    expect(rollback.isDone()).toBe(true);
    expect(stdout).toBe(`${STARTED(OLDER_UID)}${SUCCESS(OLDER_UID)}`);
    expect(onWire).toEqual([]);
  });

  it('never lists or prompts for a deployment when --deployment is given, and the list interceptor stays pending', async () => {
    lookup();
    const listed = hub().get(DEPLOYMENTS).query({ limit: 100, skip: 0, rollbackEligible: 'true' }).reply(200, LISTED);
    hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    followUp(DEPLOYMENT_UID, ['LIVE']);
    const prompts = answerPrompts({ [QUESTION]: true });

    const { error } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([QUESTION]);
    expect(listed.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('exits 2 saying there are no deployments, with nothing asked, when the environment has none', async () => {
    listing({ pagination: { count: 0, limit: 100 }, deployments: [] });
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(args(), config));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No deployments are available for rollback.');
    expect(prompts.messages).toEqual([]);
    expect(onWire).toEqual([]);
  });

  it('exits 3 and sends nothing further when Ctrl-C is pressed at the deployment picker', async () => {
    listing();
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const prompts = answerPrompts({ 'Choose a deployment for rollback': CTRL_C });

    const { error } = await onTerminal(() => runCommand(args(), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
    expect(prompts.messages).toEqual(['Choose a deployment for rollback']);
    expect(rollback.isDone()).toBe(false);
    expect(onWire).toEqual([]);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('exits 2 for a deployment uid of another environment, which the server answers as 200 with a null deployment, and never posts', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const found = hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(200, { deployment: null });
    const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No deployment with UID "${DEPLOYMENT_UID}" found in this environment.`);
    expect(prompts.messages).toEqual([]);
    expect(found.isDone()).toBe(true);
    expect(rollback.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual([POST_PENDING]);
    expect(onWire).toEqual([]);
  });

  it.each([['6accca6d34'], [`${DEPLOYMENT_UID}0`], ['z'.repeat(24)]])(
    'exits 2 for the malformed deployment uid %s and sends nothing at all',
    async (value) => {
      projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
      const found = hub().get(`${DEPLOYMENTS}/${value}`).reply(200, getFixture);
      const rollback = hub().post(`${DEPLOYMENTS}/rollback`).reply(200, {});
      const prompts = answerPrompts({});

      const { error } = await onTerminal(() => runCommand(args('--deployment', value, '--yes'), config));

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toBe(`Invalid --deployment value "${value}". Provide a 24-character hexadecimal deployment UID.`);
      expect(prompts.messages).toEqual([]);
      expect(found.isDone()).toBe(false);
      expect(rollback.isDone()).toBe(false);
      expect(onWire).toEqual([]);
    },
  );
});
