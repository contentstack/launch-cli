import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';
import open from 'open';

import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';
import { answerPrompts, CTRL_C, stdinReportingTTY, stdoutReportingTTY } from '../support/terminal';

import getFixture from '../fixtures/environment-get.json';
import listFixture from '../fixtures/environments-list.json';
import notFoundFixture from '../fixtures/environment-not-found.json';

jest.mock('open', () => jest.fn());

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const OTHER_ORG_UID = randomBytes(9).toString('hex');
const PROJECT_UID = randomBytes(12).toString('hex');
const ENV_UID = randomBytes(12).toString('hex');
const OTHER_PROJECT_ENV_UID = randomBytes(12).toString('hex');
const DATA_DIR = tmpdir();
const ENVIRONMENTS_PATH = `/manage/projects/${PROJECT_UID}/environments`;
const ENV_PATH = `${ENVIRONMENTS_PATH}/${ENV_UID}`;
const DEPLOYMENTS_PATH = `${ENV_PATH}/deployments`;
const DEPLOYMENT_UID = randomBytes(12).toString('hex');
const DEPLOYMENT_PATH = `${DEPLOYMENTS_PATH}/${DEPLOYMENT_UID}`;
const PREVIEW_URL = 'https://preview-1a2b.contentstackapps.com';
const LIVE_URL = 'https://sample-project.contentstackapps.com';
const DOMAIN_URL = 'https://production-sample-project.contentstackapps.com';
const QUESTION = 'Which domain do you want to open?';
const NOT_FOUND_LINE = 'Website URL not found.';

const SCANNED = {
  ...listFixture,
  environments: listFixture.environments.map((environment) =>
    environment.name === 'production' ? { ...environment, uid: ENV_UID } : environment,
  ),
};

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

let config: Interfaces.Config;
let onWire: string[];
let sent: string[];
let restoreStreams: (() => void)[];

function openArgs(...extra: string[]): string[] {
  return ['launch:site:open', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR, ...extra];
}

function reads(latest: unknown[]) {
  const ownership = projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
  const environment = nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .get(ENV_PATH)
    .reply(200, () => {
      sent.push(`GET ${ENV_PATH}`);
      return getFixture;
    });
  const deployments = nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .get(DEPLOYMENTS_PATH)
    .query({ limit: '1', skip: '0' })
    .reply(200, () => {
      sent.push(`GET ${DEPLOYMENTS_PATH}`);
      return { pagination: { count: latest.length, limit: 1, skip: 0 }, deployments: latest };
    });

  return { ownership, environment, deployments };
}

function runOpen(args: string[]) {
  return runCommand(args, config, { stripAnsi: false });
}

function chooseDefault(): void {
  answerPrompts({ [QUESTION]: LIVE_URL });
}

function forbidPrompts() {
  return answerPrompts({});
}

function withTerminal(stdout: boolean, stdin = stdout): void {
  restoreStreams.push(stdoutReportingTTY(stdout), stdinReportingTTY(stdin));
}

describe('integration: launch:site:open on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    onWire = [];
    sent = [];
    restoreStreams = [];
    nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
      onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
    });
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((setting: string) => CONFIG[setting]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    (open as unknown as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    restoreStreams.forEach((restore) => restore());
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('opens the latest deployment url of an environment named on the command line and says so on a terminal', async () => {
    withTerminal(true);
    chooseDefault();
    const scan = nock(LAUNCH_HUB_URL).get(ENVIRONMENTS_PATH).query({ limit: '100', skip: '0' }).reply(200, SCANNED);
    const { ownership, environment, deployments } = reads([
      { uid: 'd1', deploymentUrl: 'sample-project.contentstackapps.com' },
    ]);

    const { error, stdout } = await runOpen(openArgs('--env', 'production'));

    expect(error).toBeUndefined();
    expect(stripVTControlCharacters(stdout)).toContain(`✔ Opening ${LIVE_URL} in your browser...`);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(LIVE_URL);
    expect([ownership, scan, environment, deployments].map((scope) => scope.isDone())).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(onWire).toEqual([]);
  });

  it('opens the first domain, as projects:create announces it, when the latest deployment carries no url', async () => {
    withTerminal(true);
    reads([{ uid: 'd1', status: 'LIVE' }]);

    const { error } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(DOMAIN_URL);
    expect(onWire).toEqual([]);
  });

  it('prints only the bare url, with no escape codes, and starts no browser when stdout is not a terminal', async () => {
    withTerminal(false);
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error, stdout, stderr } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(stdout).toBe(`${LIVE_URL}\n`);
    expect(stderr).toBe('');
    expect(open).not.toHaveBeenCalled();
  });

  it('decides on stdout, not stdin: a terminal on stdin with stdout redirected still prints the bare url', async () => {
    withTerminal(false, true);
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(stdout).toBe(`${LIVE_URL}\n`);
    expect(open).not.toHaveBeenCalled();
  });

  it('still prints the opening line and exits 0 when the browser cannot be launched', async () => {
    withTerminal(true);
    chooseDefault();
    (open as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('spawn xdg-open ENOENT');
    });
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(stripVTControlCharacters(stdout)).toContain(`✔ Opening ${LIVE_URL} in your browser...`);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(LIVE_URL);
  });

  it('prints the yellow not-found line on stdout and exits 2 when the environment has a domain but no deployment', async () => {
    withTerminal(true);
    reads([]);

    const { error, stdout, stderr } = await runOpen(openArgs('--env', ENV_UID));

    expect(error?.oclif?.exit).toBe(2);
    expect(stdout).toContain(`\u001b[33m${NOT_FOUND_LINE}\u001b[39m`);
    expect(stderr).toBe('');
    expect(open).not.toHaveBeenCalled();
    expect(onWire).toEqual([]);
  });

  it('writes the plain not-found line to stderr, leaves stdout empty and exits 2 without a terminal', async () => {
    withTerminal(false);
    reads([]);

    const { error, stdout, stderr } = await runOpen(openArgs('--env', ENV_UID));

    expect(error?.oclif?.exit).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(`${NOT_FOUND_LINE}\n`);
    expect(open).not.toHaveBeenCalled();
  });

  it('sends only GET requests, the environment before the deployments, and nothing unmatched', async () => {
    withTerminal(true);
    chooseDefault();
    const { ownership, environment, deployments } = reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(sent).toEqual([`GET ${ENV_PATH}`, `GET ${DEPLOYMENTS_PATH}`]);
    expect([ownership, environment, deployments].map((scope) => scope.isDone())).toEqual([true, true, true]);
    expect(onWire).toEqual([]);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("opens the named deployment's preview url, not its deployment url, reading the environment first and never the list", async () => {
    withTerminal(true);
    const ownership = projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const environment = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .matchHeader('x-project-uid', PROJECT_UID)
      .get(ENV_PATH)
      .reply(200, () => {
        sent.push(`GET ${ENV_PATH}`);
        return getFixture;
      });
    const deployment = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .matchHeader('x-project-uid', PROJECT_UID)
      .get(DEPLOYMENT_PATH)
      .reply(200, () => {
        sent.push(`GET ${DEPLOYMENT_PATH}`);
        return { deployment: { uid: DEPLOYMENT_UID, deploymentUrl: LIVE_URL, previewUrl: PREVIEW_URL } };
      });
    const list = nock(LAUNCH_HUB_URL).get(DEPLOYMENTS_PATH).query(true).reply(200, { deployments: [] });

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID, '--deployment', DEPLOYMENT_UID));

    expect(error).toBeUndefined();
    expect(stripVTControlCharacters(stdout)).toContain(`✔ Opening ${PREVIEW_URL} in your browser...`);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(PREVIEW_URL);
    expect(sent).toEqual([`GET ${ENV_PATH}`, `GET ${DEPLOYMENT_PATH}`]);
    expect([ownership, environment, deployment].map((scope) => scope.isDone())).toEqual([true, true, true]);
    expect(list.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it('asks which domain to open as a single-select list with the default first and preselected, and opens only the one picked', async () => {
    withTerminal(true);
    const prompts = answerPrompts({ [QUESTION]: DOMAIN_URL });
    reads([{ uid: 'd1', deploymentUrl: 'sample-project.contentstackapps.com' }]);

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([QUESTION]);
    expect(prompts.payloads).toHaveLength(1);
    expect(prompts.payloads[0]).toMatchObject({
      type: 'list',
      name: 'value',
      default: LIVE_URL,
      choices: [
        { name: 'sample-project.contentstackapps.com (default)', value: LIVE_URL },
        { name: 'production-sample-project.contentstackapps.com', value: DOMAIN_URL },
      ],
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(DOMAIN_URL);
    expect(stripVTControlCharacters(stdout)).toContain(`✔ Opening ${DOMAIN_URL} in your browser...`);
    expect(onWire).toEqual([]);
  });

  it('exits 3 and opens nothing when Ctrl-C is pressed at the domain prompt, having sent only the two reads', async () => {
    withTerminal(true);
    answerPrompts({ [QUESTION]: CTRL_C });
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID));

    expect(error?.oclif?.exit).toBe(3);
    expect(open).not.toHaveBeenCalled();
    expect(stripVTControlCharacters(stdout)).not.toContain('✔ Opening');
    expect(sent).toEqual([`GET ${ENV_PATH}`, `GET ${DEPLOYMENTS_PATH}`]);
    expect(onWire).toEqual([]);
  });

  it('has no --domain flag: it is refused as unknown with exit 2 before any request or browser', async () => {
    withTerminal(true);
    forbidPrompts();
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error } = await runOpen(openArgs('--env', ENV_UID, '--domain', 'www.example.com'));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Nonexistent flag');
    expect(sent).toEqual([]);
    expect(onWire).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['stdin is a terminal and stdout is piped', false, true],
    ['neither stream is a terminal', false, false],
  ])('prints only the default url, asks nothing and opens nothing when %s', async (_label, stdout, stdin) => {
    withTerminal(stdout, stdin);
    const prompts = forbidPrompts();
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error, stdout: printed } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(printed).toBe(`${LIVE_URL}\n`);
    expect(prompts.messages).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the default url without asking when stdout is a terminal but stdin is not', async () => {
    withTerminal(true, false);
    const prompts = forbidPrompts();
    reads([{ uid: 'd1', deploymentUrl: LIVE_URL }]);

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(LIVE_URL);
    expect(stripVTControlCharacters(stdout)).toContain(`✔ Opening ${LIVE_URL} in your browser...`);
  });

  it('asks nothing for a named deployment on a terminal and opens its preview url', async () => {
    withTerminal(true);
    const prompts = forbidPrompts();
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL)
      .get(ENV_PATH)
      .reply(200, () => {
        sent.push(`GET ${ENV_PATH}`);
        return getFixture;
      });
    nock(LAUNCH_HUB_URL)
      .get(DEPLOYMENT_PATH)
      .reply(200, () => {
        sent.push(`GET ${DEPLOYMENT_PATH}`);
        return { deployment: { uid: DEPLOYMENT_UID, deploymentUrl: LIVE_URL, previewUrl: PREVIEW_URL } };
      });

    const { error } = await runOpen(openArgs('--env', ENV_UID, '--deployment', DEPLOYMENT_UID));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([]);
    expect(open).toHaveBeenCalledWith(PREVIEW_URL);
    expect(sent).toEqual([`GET ${ENV_PATH}`, `GET ${DEPLOYMENT_PATH}`]);
  });

  it('exits 2 with the yellow not-found line and asks nothing when there is no deployment but two domains', async () => {
    withTerminal(true);
    const prompts = forbidPrompts();
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL)
      .get(ENV_PATH)
      .reply(200, {
        environment: {
          ...getFixture.environment,
          domains: [{ url: DOMAIN_URL }, { url: 'https://www.example.com' }],
        },
      });
    nock(LAUNCH_HUB_URL)
      .get(DEPLOYMENTS_PATH)
      .query({ limit: '1', skip: '0' })
      .reply(200, { pagination: { count: 0, limit: 1, skip: 0 }, deployments: [] });

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID));

    expect(error?.oclif?.exit).toBe(2);
    expect(stdout).toContain(`\u001b[33m${NOT_FOUND_LINE}\u001b[39m`);
    expect(prompts.messages).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a deployment that is not a 24-hex uid before any request reaches the wire', async () => {
    withTerminal(true);

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID, '--deployment', 'not-a-uid'));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--deployment');
    expect(stdout).toBe('');
    expect(onWire).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('exits 2 with the not-found wording for a deployment the environment does not have', async () => {
    withTerminal(true);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL).get(ENV_PATH).reply(200, getFixture);
    const deployment = nock(LAUNCH_HUB_URL)
      .get(DEPLOYMENT_PATH)
      .reply(404, { errors: [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'Deployment not found' }] });

    const { error, stdout } = await runOpen(openArgs('--env', ENV_UID, '--deployment', DEPLOYMENT_UID));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No deployment found with that UID.');
    expect(deployment.isDone()).toBe(true);
    expect(stdout).toBe('');
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a project that belongs to another organization before reading the environment', async () => {
    withTerminal(true);
    const ownership = projectOwnership(LAUNCH_HUB_URL, OTHER_ORG_UID, PROJECT_UID);
    const environment = nock(LAUNCH_HUB_URL).get(ENV_PATH).query(true).reply(200, getFixture);
    const deployments = nock(LAUNCH_HUB_URL).get(DEPLOYMENTS_PATH).query(true).reply(200, { deployments: [] });

    const { error } = await runOpen([
      'launch:site:open',
      '--org',
      OTHER_ORG_UID,
      '--project',
      PROJECT_UID,
      '--env',
      ENV_UID,
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No project with UID "${PROJECT_UID}" found in this organization.`);
    expect([ownership.isDone(), environment.isDone(), deployments.isDone()]).toEqual([true, false, false]);
    expect(open).not.toHaveBeenCalled();
  });

  it('exits 2 with the not-found wording for an environment uid of another project, reading no deployment', async () => {
    withTerminal(true);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const lookup = nock(LAUNCH_HUB_URL)
      .get(`${ENVIRONMENTS_PATH}/${OTHER_PROJECT_ENV_UID}`)
      .reply(404, notFoundFixture);
    const deployments = nock(LAUNCH_HUB_URL)
      .get(`${ENVIRONMENTS_PATH}/${OTHER_PROJECT_ENV_UID}/deployments`)
      .query(true)
      .reply(200, { deployments: [] });

    const { error, stdout } = await runOpen(openArgs('--env', OTHER_PROJECT_ENV_UID));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No environment found with that name or UID.');
    expect([lookup.isDone(), deployments.isDone()]).toEqual([true, false]);
    expect(stdout).toBe('');
    expect(open).not.toHaveBeenCalled();
  });

  it('exits 2 for an environment name the project does not have, sending no environment or deployment request', async () => {
    withTerminal(true);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL).get(ENVIRONMENTS_PATH).query({ limit: '100', skip: '0' }).reply(200, SCANNED);
    const environment = nock(LAUNCH_HUB_URL)
      .get(/\/environments\/[0-9a-f]{24}$/)
      .reply(200, getFixture);
    const deployments = nock(LAUNCH_HUB_URL)
      .get(/\/deployments$/)
      .query(true)
      .reply(200, { deployments: [] });

    const { error } = await runOpen(openArgs('--env', 'other-project-env'));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No environment named "other-project-env" found in this project.');
    expect([environment.isDone(), deployments.isDone()]).toEqual([false, false]);
    expect(open).not.toHaveBeenCalled();
    expect(onWire).toEqual([]);
  });
});
