import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import * as watcher from '../../src/deployments/deployment.watcher';
import fileUploadProject from '../fixtures/project-get-fileupload.json';
import { answerPrompts, CTRL_C, onTerminal, stdinReportingTTY, stdoutReportingTTY } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

jest.mock('open', () => jest.fn().mockResolvedValue(undefined));

const realWatchTiming = watcher.defaultWatchTiming;

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const UPLOAD_HOST = 'https://uploads.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'e1f2a3b4c5d6e7f8091a2b3c';
const DEPLOYMENT_UID = 'd1e2f3a4b5c6d7e8f9012345';
const COMMIT = '9fceb02d0ae598e95dc970b74767f19372d61af8';
const SITE_PAGE = `<h1>site</h1><!-- ${randomBytes(2048).toString('hex')} -->`;

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
const SIGNED_URL = `${DEPLOYMENTS}/upload/signed_url`;
const COMMITS = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/commits`;
const LOGS = `/logs/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments/${DEPLOYMENT_UID}/logs/deployment-logs`;
const LOGS_HINT = `csdx launch:logs:get --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID} --deployment ${DEPLOYMENT_UID}`;
const GET_HINT = `csdx launch:deployments:get --org ${ORG_UID} --project ${PROJECT_UID} --env ${ENV_UID} --deployment ${DEPLOYMENT_UID}`;

let config: Interfaces.Config;
let onWire: string[];
let dataDir: string;
let missingDir: string;

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

function createArgs(...extra: string[]): string[] {
  return ['launch:deployments:create', '--org', ORG_UID, '--project', PROJECT_UID, '--env', ENV_UID, ...extra];
}

function gitProject(): void {
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
}

function fileProject(): void {
  nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).reply(200, fileUploadProject);
  nock(LAUNCH_HUB_URL).get(`/manage/projects/${PROJECT_UID}`).reply(200, fileUploadProject);
}

interface Created {
  scope: nock.Scope;
  body: () => unknown;
  contentType: () => string | string[] | undefined;
}

function captureCreate(
  status = 201,
  reply: unknown = { deployment: { uid: DEPLOYMENT_UID, status: 'QUEUED' } },
): Created {
  let sent: unknown;
  let contentType: string | string[] | undefined;
  const scope = hub()
    .post(DEPLOYMENTS, (body: unknown) => {
      sent = body;
      return true;
    })
    .query({})
    .reply(status, function () {
      contentType = this.req.headers['content-type'];
      return reply as nock.Body;
    });

  return { scope, body: () => sent, contentType: () => contentType };
}

function followUp(statuses: string[], logs: { message: string; timestamp: string }[][] = []): nock.Scope[] {
  const scopes: nock.Scope[] = [];

  statuses.forEach((status, index) => {
    scopes.push(
      hub()
        .get(`${DEPLOYMENTS}/${DEPLOYMENT_UID}`)
        .query({})
        .reply(200, { deployment: { uid: DEPLOYMENT_UID, status, deploymentUrl: 'my-site.example.test' } }),
    );
    scopes.push(
      hub()
        .get(LOGS)
        .query(true)
        .reply(200, { deploymentLogs: logs[index] ?? [] }),
    );
  });

  return scopes;
}

function signedUpload(): { scope: nock.Scope; uploadUid: string } {
  const uploadUid = randomBytes(12).toString('hex');
  const scope = hub()
    .get(SIGNED_URL)
    .query({})
    .reply(200, {
      uploadUrl: `${UPLOAD_HOST}/bucket`,
      expiresIn: Date.now() + 600_000,
      uploadUid,
      method: 'PUT',
      headers: [
        { key: 'x-ms-blob-type', value: 'BlockBlob' },
        { key: 'Content-Type', value: 'application/zip' },
      ],
    });

  return { scope, uploadUid };
}

describe('integration: launch:deployments:create on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    dataDir = mkdtempSync(join(tmpdir(), 'launch-deployments-create-'));
    missingDir = join(dataDir, 'no-such-folder');
    writeFileSync(join(dataDir, 'index.html'), SITE_PAGE);
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
    rmSync(dataDir, { recursive: true, force: true });
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('T20: deploys the branch tip of a GitHub project with an empty body, the environment being in the path, and exits 0 on LIVE', async () => {
    gitProject();
    const create = captureCreate();
    const signed = signedUpload();
    const commits = hub().get(COMMITS).query(true).reply(200, { commits: [] });
    followUp(['LIVE']);

    const { error } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error).toBeUndefined();
    expect(create.scope.isDone()).toBe(true);
    expect(create.body()).toEqual({});
    expect(Object.keys(create.body() as object)).toEqual([]);
    expect(create.contentType()).toBe('application/json');
    expect(signed.scope.isDone()).toBe(false);
    expect(commits.isDone()).toBe(false);
    expect(nock.pendingMocks()).toEqual(expect.arrayContaining([expect.stringContaining('upload/signed_url')]));
    expect(onWire).toEqual([]);
  });

  it('T21: deploys the named commit with a body of only the commit hash, asking nothing', async () => {
    gitProject();
    const create = captureCreate();
    const signed = signedUpload();
    const commits = hub().get(COMMITS).query(true).reply(200, { commits: [] });
    followUp(['LIVE']);
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(createArgs('--commit', COMMIT, '--data-dir', dataDir), config));

    expect(error).toBeUndefined();
    expect(create.body()).toEqual({ commitHash: COMMIT });
    expect(prompts.messages).toEqual([]);
    expect(commits.isDone()).toBe(false);
    expect(signed.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T22: refuses --last-upload on a GitHub project with exit 2 naming --commit and sends nothing', async () => {
    gitProject();
    const create = captureCreate();
    const signed = signedUpload();

    const { error } = await runCommand(createArgs('--last-upload', '--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--commit');
    expect(create.scope.isDone()).toBe(false);
    expect(signed.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T23: zips and uploads the project directory, then deploys the new upload uid and exits 0 on LIVE', async () => {
    fileProject();
    const signed = signedUpload();
    const put = nock(UPLOAD_HOST)
      .matchHeader('x-ms-blob-type', 'BlockBlob')
      .matchHeader('content-type', 'application/zip')
      .put('/bucket')
      .reply(201, '');
    const create = captureCreate();
    followUp(['LIVE']);

    const { error } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error).toBeUndefined();
    expect(signed.scope.isDone()).toBe(true);
    expect(put.isDone()).toBe(true);
    expect(create.body()).toEqual({ uploadUid: signed.uploadUid });
    expect(onWire).toEqual([]);
  });

  it('T24: refuses --commit on a FileUpload project that has a directory, naming --last-upload', async () => {
    fileProject();
    const create = captureCreate();
    const signed = signedUpload();

    const { error } = await runCommand(createArgs('--commit', COMMIT, '--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--last-upload');
    expect(create.scope.isDone()).toBe(false);
    expect(signed.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T25: refuses a bare --commit on a FileUpload project with a directory at a terminal, naming --last-upload, with no prompt', async () => {
    fileProject();
    const create = captureCreate();
    const signed = signedUpload();
    const commits = hub().get(COMMITS).query(true).reply(200, { commits: [] });
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(createArgs('--commit', '--data-dir', dataDir), config));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--last-upload');
    expect(prompts.messages).toEqual([]);
    expect(commits.isDone()).toBe(false);
    expect(create.scope.isDone()).toBe(false);
    expect(signed.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T26: redeploys the last bundle with --last-upload, sending an empty body and never asking for a signed url', async () => {
    fileProject();
    const signed = signedUpload();
    const put = nock(UPLOAD_HOST).put('/bucket').reply(201, '');
    const create = captureCreate();
    followUp(['LIVE']);

    const { error } = await runCommand(createArgs('--last-upload', '--data-dir', dataDir), config);

    expect(error).toBeUndefined();
    expect(create.body()).toEqual({});
    expect(Object.keys(create.body() as object)).toEqual([]);
    expect(signed.scope.isDone()).toBe(false);
    expect(nock.pendingMocks().some((mock) => mock.includes('upload/signed_url'))).toBe(true);
    expect(put.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T27: refuses a missing project directory with exit 2, naming the path, --data-dir and --last-upload, and sends nothing', async () => {
    fileProject();
    const create = captureCreate();
    const signed = signedUpload();

    const { error } = await runCommand(createArgs('--data-dir', missingDir), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain(`"${missingDir}"`);
    expect(error?.message).toContain('--data-dir');
    expect(error?.message).toContain('--last-upload');
    expect(create.scope.isDone()).toBe(false);
    expect(signed.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T28: refuses --commit on a FileUpload project with no directory, naming --last-upload', async () => {
    fileProject();
    const create = captureCreate();
    const signed = signedUpload();

    const { error } = await runCommand(createArgs('--commit', COMMIT, '--data-dir', missingDir), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--last-upload');
    expect(create.scope.isDone()).toBe(false);
    expect(signed.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it.each([
    ['at a terminal', true],
    ['without a terminal', false],
  ])(
    'T29: refuses a bare --commit on a FileUpload project with no directory %s, naming --last-upload',
    async (_label, terminal) => {
      fileProject();
      const create = captureCreate();
      const signed = signedUpload();
      const commits = hub().get(COMMITS).query(true).reply(200, { commits: [] });
      const prompts = answerPrompts({});
      const restore = stdinReportingTTY(terminal);

      try {
        const { error } = await runCommand(createArgs('--commit', '--data-dir', missingDir), config);

        expect(error?.oclif?.exit).toBe(2);
        expect(error?.message).toContain('--last-upload');
      } finally {
        restore();
      }

      expect(prompts.messages).toEqual([]);
      expect(commits.isDone()).toBe(false);
      expect(create.scope.isDone()).toBe(false);
      expect(signed.scope.isDone()).toBe(false);
      expect(onWire).toEqual([]);
    },
  );

  it('T30: redeploys the last bundle with no directory present, sending an empty body and attempting no archive', async () => {
    fileProject();
    const signed = signedUpload();
    const create = captureCreate();
    followUp(['LIVE']);

    const { error, stdout } = await runCommand(createArgs('--last-upload', '--data-dir', missingDir), config);

    expect(error).toBeUndefined();
    expect(create.body()).toEqual({});
    expect(signed.scope.isDone()).toBe(false);
    expect(stdout).not.toContain('Preparing zip file');
    expect(onWire).toEqual([]);
  });

  it.each([
    ['a GitHub project', gitProject],
    ['a FileUpload project', fileProject],
  ])('T31: refuses --commit with --last-upload on %s with exit 2 before any request', async (_label, project) => {
    project();
    const create = captureCreate();

    const { error } = await runCommand(createArgs('--commit', COMMIT, '--last-upload', '--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(create.scope.isDone()).toBe(false);
    expect(nock.pendingMocks().filter((mock) => mock.endsWith(`/manage/projects/${PROJECT_UID}`))).toHaveLength(2);
    expect(onWire).toEqual([]);
  });

  it('T50: asks one list prompt over the commits at a terminal and deploys the full sha of the chosen one', async () => {
    gitProject();
    const create = captureCreate();
    const first = randomBytes(20).toString('hex');
    const second = randomBytes(20).toString('hex');
    let asked: unknown;
    const commits = hub()
      .get(COMMITS)
      .query((query) => {
        asked = query;
        return true;
      })
      .reply(200, {
        pagination: { count: 2 },
        commits: [
          { sha: first, shortSha: first.slice(0, 7), message: 'first change', author: { name: 'A' }, url: 'u1' },
          {
            sha: second,
            shortSha: second.slice(0, 7),
            message: 'second change\nbody line',
            author: { name: 'B' },
            url: 'u2',
          },
        ],
      });
    followUp(['LIVE']);
    const prompts = answerPrompts({ 'Choose a commit for deployment': second });

    const { error } = await onTerminal(() => runCommand(createArgs('--commit', '--data-dir', dataDir), config));

    expect(error).toBeUndefined();
    expect(commits.isDone()).toBe(true);
    expect(asked).toEqual({ limit: '15' });
    expect(prompts.messages).toEqual(['Choose a commit for deployment']);
    expect(prompts.payloads[0]).toMatchObject({
      type: 'list',
      choices: [
        { name: `${first.slice(0, 7)}  first change`, value: first },
        { name: `${second.slice(0, 7)}  second change`, value: second },
      ],
    });
    expect(create.body()).toEqual({ commitHash: second });
    expect(onWire).toEqual([]);
  });

  it('T51: refuses a bare --commit without a terminal with exit 2 naming --commit <sha>, before any commits request or prompt', async () => {
    gitProject();
    const create = captureCreate();
    const commits = hub()
      .get(COMMITS)
      .query(true)
      .reply(200, { commits: [{ sha: COMMIT }] });
    const prompts = answerPrompts({});
    const restore = stdinReportingTTY(false);

    try {
      const { error } = await runCommand(createArgs('--commit', '--data-dir', dataDir), config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toContain('--commit <sha>');
    } finally {
      restore();
    }

    expect(prompts.messages).toEqual([]);
    expect(commits.isDone()).toBe(false);
    expect(create.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T52: exits 3 with the cancelled message when Ctrl-C hits the commit picker, creating nothing', async () => {
    gitProject();
    const create = captureCreate();
    hub()
      .get(COMMITS)
      .query(true)
      .reply(200, { commits: [{ sha: COMMIT, shortSha: COMMIT.slice(0, 7), message: 'm' }] });
    answerPrompts({ 'Choose a commit for deployment': CTRL_C });

    const { error } = await onTerminal(() => runCommand(createArgs('--commit', '--data-dir', dataDir), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(error?.message).toContain('Cancelled. Nothing was changed.');
    expect(create.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('exits 1 and creates nothing when the commits lookup fails at a terminal', async () => {
    gitProject();
    const create = captureCreate();
    hub().get(COMMITS).query(true).reply(400, { error_code: 'launch.ENVIRONMENT.NOT_FOUND' });
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(createArgs('--commit', '--data-dir', dataDir), config));

    expect(error?.oclif?.exit).toBe(1);
    expect(prompts.messages).toEqual([]);
    expect(create.scope.isDone()).toBe(false);
  });

  it('T31: also refuses a bare --commit with --last-upload before any request', async () => {
    gitProject();
    const create = captureCreate();

    const { error } = await runCommand(createArgs('--commit', '--last-upload', '--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(create.scope.isDone()).toBe(false);
    expect(nock.pendingMocks().filter((mock) => mock.endsWith(`/manage/projects/${PROJECT_UID}`))).toHaveLength(2);
    expect(onWire).toEqual([]);
  });

  it('refuses --commit with a blank value with exit 2 naming --commit <sha>, never deploying the branch tip', async () => {
    gitProject();
    const create = captureCreate();

    const { error } = await runCommand(
      [
        'launch:deployments:create',
        '--org',
        ORG_UID,
        '--project',
        PROJECT_UID,
        '--env',
        ENV_UID,
        '--commit=',
        '--data-dir',
        dataDir,
      ],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--commit <sha>');
    expect(create.scope.isDone()).toBe(false);
  });

  it('T33: waits through QUEUED and DEPLOYING to LIVE, streams the build log once and prints the Deployment URL', async () => {
    gitProject();
    captureCreate();
    followUp(
      ['QUEUED', 'DEPLOYING', 'LIVE'],
      [[], [{ message: 'Installing dependencies', timestamp: '2026-09-25T10:00:00.000Z' }], []],
    );

    const { error, stdout } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error).toBeUndefined();
    expect(stdout.split('Installing dependencies').length - 1).toBe(1);
    expect(stdout).toContain('Deployment URL: https://my-site.example.test');
    expect(nock.pendingMocks()).toEqual([]);
    expect(onWire).toEqual([]);
  });

  it('T33: exits 1 on a FAILED deployment, naming FAILED and the logs command with the full scope', async () => {
    gitProject();
    captureCreate();
    followUp(['DEPLOYING', 'FAILED']);

    const { error, stdout } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('FAILED');
    expect(error?.message).toContain(LOGS_HINT);
    expect(stdout).not.toContain('Deployment URL');
    expect(onWire).toEqual([]);
  });

  it('T33: exits 1 when the wait runs out, pointing at deployments:get rather than another create', async () => {
    gitProject();
    captureCreate();
    followUp(['DEPLOYING']);
    jest.spyOn(watcher, 'defaultWatchTiming').mockImplementation(() => ({
      ...realWatchTiming(),
      sleep: async () => undefined,
      timeoutMs: 1,
    }));

    const { error } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('still DEPLOYING');
    expect(error?.message).toContain(GET_HINT);
    expect(error?.message).not.toContain('deployments:create');
  });

  it.each([
    [400, 'a 400'],
    [503, 'a 503'],
  ])(
    'T36: exits 1 with the CLI wording on %s CREATE_FAILED, putting the POST on the wire once and polling nothing',
    async (status) => {
      gitProject();
      const create = captureCreate(status, {
        errors: [{ code: 'launch.DEPLOYMENT.CREATE_FAILED', message: 'raw server text' }],
        status,
      });
      const poll = followUp(['LIVE']);

      const { error } = await runCommand(createArgs('--data-dir', dataDir), config);

      expect(error?.oclif?.exit).toBe(1);
      expect(error?.message).toBe('The deployment could not be started. Please try again or contact support.');
      expect(create.scope.isDone()).toBe(true);
      expect(poll.every((scope) => !scope.isDone())).toBe(true);
      expect(onWire).toEqual([]);
    },
  );

  it('words a field-keyed validation rejection from the server with the field and its reason, never a bare Bad request', async () => {
    gitProject();
    const create = captureCreate(400, {
      errors: [{ environment: { code: 'property environment should not exist', message: 'Bad request' } }],
      status: 400,
    });

    const { error } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('The Launch API rejected the request: environment: property environment should not exist');
    expect(error?.message).not.toBe('Bad request');
    expect(create.scope.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('T38: refuses an archive under the minimum size with exit 2 before asking for a signed url', async () => {
    fileProject();
    const tiny = mkdtempSync(join(tmpdir(), 'launch-deployments-tiny-'));
    writeFileSync(join(tiny, 'a.txt'), 'x');
    const signed = signedUpload();
    const create = captureCreate();

    try {
      const { error } = await runCommand(createArgs('--data-dir', tiny), config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toContain('below the');
      expect(signed.scope.isDone()).toBe(false);
      expect(create.scope.isDone()).toBe(false);
      expect(onWire).toEqual([]);
    } finally {
      rmSync(tiny, { recursive: true, force: true });
    }
  });

  it('T38: exits 1 with readable wording when the signed url cannot be had, and posts nothing', async () => {
    fileProject();
    const signed = hub()
      .get(SIGNED_URL)
      .query({})
      .reply(400, {
        errors: [{ code: 'launch.DEPLOYMENT.FILE_UPLOAD_SIGNED_URL.GET_FAILED', message: 'raw' }],
        status: 400,
      });
    const create = captureCreate();

    const { error } = await runCommand(createArgs('--data-dir', dataDir), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('The Launch API could not prepare an upload for your deployment files.');
    expect(signed.isDone()).toBe(true);
    expect(create.scope.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('T40: draws the no-directory error red when stdout is a terminal', async () => {
    fileProject();
    const restoreOut = stdoutReportingTTY(true);

    try {
      const { error, stderr } = await runCommand(createArgs('--data-dir', missingDir), config, { stripAnsi: false });

      expect(error?.oclif?.exit).toBe(2);
      expect(stderr).toContain('\u001b[31merror: No files to upload were found in');
    } finally {
      restoreOut();
    }
  });

  it('T40: draws it plain when only stdin is a terminal and stdout is piped', async () => {
    fileProject();
    const restoreOut = stdoutReportingTTY(false);
    const restoreIn = stdinReportingTTY(true);

    try {
      const { error, stderr } = await runCommand(createArgs('--data-dir', missingDir), config, { stripAnsi: false });

      expect(error?.oclif?.exit).toBe(2);
      expect(stderr).toContain('error: No files to upload were found in');
      expect(stderr).not.toContain('\u001b');
    } finally {
      restoreIn();
      restoreOut();
    }
  });
});
