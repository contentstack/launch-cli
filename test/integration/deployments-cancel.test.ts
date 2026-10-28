import { tmpdir } from 'node:os';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

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
const QUESTION = `Cancel deployment "${DEPLOYMENT_UID}"? This cannot be undone.`;
const CANCEL_PATH = `${DEPLOYMENTS}/${DEPLOYMENT_UID}/cancel`;
const POST_PENDING = `POST ${LAUNCH_HUB_URL}:443${CANCEL_PATH}`;
const BODYLESS = { badheaders: ['content-type'] };
const RAW_REFUSAL = 'This deployment has progressed beyond the point where it can be cancelled.';
const CANCEL_WORDING =
  'This deployment can no longer be cancelled because it is already past the point where cancelling is possible.';

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
    'launch:deployments:cancel',
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

function cancelScope(): nock.Scope {
  return nock(LAUNCH_HUB_URL, BODYLESS)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

function lookup(): nock.Scope {
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);

  return hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(200, getFixture);
}

describe('integration: launch:deployments:cancel on the wire', () => {
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

  it('looks the deployment up, then posts a bodyless cancel, when --yes is given', async () => {
    const order: string[] = [];
    const found = lookup();
    found.on('replied', () => order.push('lookup'));
    const headers: Record<string, unknown>[] = [];
    const bodies: string[] = [];
    const cancel = cancelScope()
      .post(CANCEL_PATH, (body: unknown) => {
        bodies.push(JSON.stringify(body));
        return true;
      })
      .reply(200, getFixture);
    cancel.on('request', (request: { headers: Record<string, unknown> }) => {
      order.push('cancel');
      headers.push(request.headers);
    });
    const prompts = answerPrompts({});

    const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error).toBeUndefined();
    expect(order).toEqual(['lookup', 'cancel']);
    expect(cancel.isDone()).toBe(true);
    expect(bodies).toEqual(['""']);
    expect(headers[0]['content-type']).toBeUndefined();
    expect(prompts.messages).toEqual([]);
    expect(stdout).toBe(`✔ Deployment "${DEPLOYMENT_UID}" cancelled.\n`);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming --deployment and sends nothing when it is omitted, empty or whitespace', async () => {
    for (const extra of [[], ['--deployment', '""'], ['--deployment', '"   "']]) {
      projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
      const cancel = cancelScope().post(CANCEL_PATH).reply(200, {});

      const { error } = await runCommand(args(...extra, '--yes'), config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toContain('Missing required value for --deployment');
      expect(cancel.isDone()).toBe(false);
    }

    expect(onWire).toEqual([]);
  });

  it('says the deployment was not cancelled, exits 3 and never posts when the user declines', async () => {
    const found = lookup();
    const cancel = cancelScope().post(CANCEL_PATH).reply(200, {});
    const restore = pretendTerminal();
    const inquired: unknown[] = [];
    jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
      inquired.push(payload);
      return false as never;
    });

    try {
      const { error, stdout } = await runCommand(args('--deployment', DEPLOYMENT_UID), config);

      expect(error?.oclif?.exit).toBe(3);
      expect(stdout).toBe('Deployment not cancelled.\n');
      expect(inquired).toEqual([{ type: 'confirm', name: 'confirm', message: QUESTION, default: false }]);
      expect(found.isDone()).toBe(true);
      expect(cancel.isDone()).toBe(false);
      expect(nock.pendingMocks()).toEqual([POST_PENDING]);
      expect(onWire).toEqual([]);
    } finally {
      restore();
    }
  });

  it('exits 2 naming --yes, and never posts, without a terminal and without --yes', async () => {
    const found = lookup();
    const cancel = cancelScope().post(CANCEL_PATH).reply(200, {});

    const { error } = await runCommand(args('--deployment', DEPLOYMENT_UID), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${QUESTION} Pass --yes to confirm without an interactive terminal.`);
    expect(found.isDone()).toBe(true);
    expect(cancel.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual([POST_PENDING]);
    expect(onWire).toEqual([]);
  });

  it('exits 3 and never posts when Ctrl-C is pressed at the confirmation', async () => {
    const found = lookup();
    const cancel = cancelScope().post(CANCEL_PATH).reply(200, {});
    const prompts = answerPrompts({ [QUESTION]: CTRL_C });

    const { error } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toBe('Cancelled. Nothing was changed.');
    expect(prompts.messages).toEqual([QUESTION]);
    expect(found.isDone()).toBe(true);
    expect(cancel.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('posts exactly once and exits 0 when the user says yes at the prompt', async () => {
    lookup();
    const cancel = cancelScope().post(CANCEL_PATH).once().reply(200, getFixture);
    const prompts = answerPrompts({ [QUESTION]: true });

    const { error, stdout } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([QUESTION]);
    expect(cancel.isDone()).toBe(true);
    expect(stdout).toBe(`✔ Deployment "${DEPLOYMENT_UID}" cancelled.\n`);
    expect(onWire).toEqual([]);
  });

  it('reports the generic not-found wording, exit 2, and never posts for an unknown or foreign deployment', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const found = hub().get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`).reply(404, notFoundFixture);
    const cancel = cancelScope().post(CANCEL_PATH).reply(200, {});
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(args('--deployment', DEPLOYMENT_UID), config));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No deployment with UID "${DEPLOYMENT_UID}" found in this environment.`);
    expect(prompts.messages).toEqual([]);
    expect(found.isDone()).toBe(true);
    expect(cancel.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual([POST_PENDING]);
    expect(onWire).toEqual([]);
  });

  it.each([
    ['the CANCEL_NOT_ALLOWED code', { code: 'launch.DEPLOYMENT.CANCEL_NOT_ALLOWED', message: 'x' }],
    ['the raw server message as the code', { code: RAW_REFUSAL, message: RAW_REFUSAL }],
    ['the raw server message alone', { message: RAW_REFUSAL }],
  ])('exits 1 with readable wording, posting once, when the cancel is refused with %s', async (_name, entry) => {
    lookup();
    const cancel = cancelScope()
      .post(CANCEL_PATH)
      .once()
      .reply(400, { errors: [entry], status: 400 });

    const { error } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(CANCEL_WORDING);
    expect(cancel.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('exits 1 with the deployment wording when the cancel itself answers 404 NOT_FOUND', async () => {
    lookup();
    cancelScope().post(CANCEL_PATH).reply(404, notFoundFixture);

    const { error } = await runCommand(args('--deployment', DEPLOYMENT_UID, '--yes'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No deployment found with that UID.');
  });
});
