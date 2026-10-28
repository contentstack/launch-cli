import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { answerPrompts, onTerminal } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { projectOwnership } from '../support/project-ownership';

import getFixture from '../fixtures/environment-get.json';
import listFixture from '../fixtures/environments-list.json';
import notFoundFixture from '../fixtures/environment-not-found.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = randomBytes(12).toString('hex');
const ENV_UID = randomBytes(12).toString('hex');
const ENV_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`;
const PURGE_PATH = `${ENV_PATH}/revalidate-cdn-cache`;
const FOREIGN_ENV_UID = randomBytes(12).toString('hex');
const OTHER_ORG_UID = randomBytes(9).toString('hex');
const DATA_DIR = tmpdir();
const QUOTA_CODE = 'launch.ORGANIZATION.REVALIDATE_RATE_LIMIT_EXCEEDED';
const QUOTA_MESSAGE = 'This organization has reached its daily CDN cache purge limit. The limit resets at 00:00 UTC.';
const CRITERIA = ['--path', '--tags', '--hosts'];
const ONE_OF = `Pass exactly one of ${CRITERIA.join(', ')}`;
const TASK_LINE = '→ CDN cache revalidation task initiated.';
const INITIATED = { message: 'The CDN cache revalidation task has been initiated.' };

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

function purgeArgs(...extra: string[]): string[] {
  return ['launch:cache:purge', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR, ...extra];
}

function lookupAndPurge(body: nock.RequestBodyMatcher) {
  projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
  const lookup = nock(LAUNCH_HUB_URL)
    .matchHeader('x-project-uid', PROJECT_UID)
    .get(ENV_PATH)
    .reply(200, getFixture);
  const purge = nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .post(PURGE_PATH, body)
    .reply(200, INITIATED);

  return { lookup, purge };
}

describe('integration: launch:cache:purge on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    onWire = [];
    nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
      onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
    });
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((setting: string) => CONFIG[setting]);
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

  it('reads the environment then sends one POST for an exact path and exits 0', async () => {
    const { lookup, purge } = lookupAndPurge({ cachePath: { path: '/blog', isPrefix: false } });

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/blog'), config);

    expect(error).toBeUndefined();
    expect([lookup.isDone(), purge.isDone()]).toEqual([true, true]);
    expect(onWire).toEqual([]);
  });

  it('resolves an environment name by scanning, reads it by uid and then purges', async () => {
    const scan = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments`)
      .query({ limit: '100', skip: '0' })
      .reply(200, SCANNED);
    const { lookup, purge } = lookupAndPurge({ cachePath: { path: '/blog', isPrefix: false } });

    const { error } = await runCommand(purgeArgs('--env', 'production', '--path', '/blog'), config);

    expect(error).toBeUndefined();
    expect([scan.isDone(), lookup.isDone(), purge.isDone()]).toEqual([true, true, true]);
    expect(onWire).toEqual([]);
  });

  it('sends a trailing /* as a prefix match on the path without it', async () => {
    const { purge } = lookupAndPurge({ cachePath: { path: '/blog', isPrefix: true } });

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/blog/*'), config);

    expect(error).toBeUndefined();
    expect(purge.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('sends /* alone as the root prefix with neither tags nor hostnames', async () => {
    const { purge } = lookupAndPurge({ cachePath: { path: '/', isPrefix: true } });

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/*'), config);

    expect(error).toBeUndefined();
    expect(purge.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('sends tags trimmed, without empties or duplicates, as cacheTags', async () => {
    const { purge } = lookupAndPurge({ cacheTags: ['a', 'b'] });

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--tags', 'a,b,a,'), config);

    expect(error).toBeUndefined();
    expect(purge.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('sends hosts the same way as hostnames', async () => {
    const { purge } = lookupAndPurge({ hostnames: ['www.example.com', 'example.com'] });

    const { error } = await runCommand(
      purgeArgs('--env', ENV_UID, '--hosts', 'www.example.com,example.com,www.example.com'),
      config,
    );

    expect(error).toBeUndefined();
    expect(purge.isDone()).toBe(true);
    expect(onWire).toEqual([]);
  });

  it('names the environment, not the uid, in the success line, with no escape codes off a terminal', async () => {
    lookupAndPurge({ cachePath: { path: '/blog', isPrefix: true } });

    const { error, stdout } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/blog/*'), config);

    expect(error).toBeUndefined();
    expect(stdout).toBe(
      `✔ Cache purge initiated for path /blog/* (prefix match) in environment "production".\n${TASK_LINE}\n`,
    );
  });

  it('exits 2 naming all three flags when none is given, without a terminal, and reads and purges nothing', async () => {
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(purgeArgs('--env', ENV_UID), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${ONE_OF}; none was supplied.`);
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 the same way on a terminal, and never prompts for a criterion', async () => {
    const { lookup, purge } = lookupAndPurge({});
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() => runCommand(purgeArgs('--env', ENV_UID), config));

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${ONE_OF}; none was supplied.`);
    expect(prompts.messages).toEqual([]);
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming the two flags supplied and sends no request about the environment', async () => {
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/blog', '--tags', 'a'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${ONE_OF}; --path, --tags were supplied.`);
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 naming all three flags when all three are supplied and sends no purge', async () => {
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(
      purgeArgs('--env', ENV_UID, '--path', '/blog', '--tags', 'a', '--hosts', 'example.com'),
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${ONE_OF}; --path, --tags, --hosts were supplied.`);
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 for a path without a leading slash and sends nothing about the environment', async () => {
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--path', 'blog'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('--path must start with "/"; "blog" does not.');
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 for a tag list that is empty once cleaned and sends nothing about the environment', async () => {
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--tags', ','), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('--tags must name at least one value; "," names none.');
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
  });

  it('stops on the quota 429 after one POST, words it, and exits 1', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL).matchHeader('x-project-uid', PROJECT_UID).get(ENV_PATH).reply(200, getFixture);
    let posts = 0;
    nock(LAUNCH_HUB_URL)
      .post(PURGE_PATH)
      .times(4)
      .reply(() => {
        posts += 1;
        return [429, { errors: [{ code: QUOTA_CODE, message: 'Rate limit exceeded' }], status: 429 }];
      });

    const { error, stderr } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/blog'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(QUOTA_MESSAGE);
    expect(posts).toBe(1);
    expect(stderr).not.toContain('\u001b');
    expect(onWire).toEqual([]);
  });

  it('prints the quota wording alone on stderr, with no escape codes off a terminal', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL).matchHeader('x-project-uid', PROJECT_UID).get(ENV_PATH).reply(200, getFixture);
    nock(LAUNCH_HUB_URL)
      .post(PURGE_PATH)
      .reply(429, { errors: [{ code: QUOTA_CODE, message: 'Rate limit exceeded' }], status: 429 });

    const { error, stderr } = await runCommand(purgeArgs('--env', ENV_UID, '--path', '/blog'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(stderr).toBe(`error: ${QUOTA_MESSAGE}\n`);
  });

  it('exits 1 with the permission wording on a 403 and sends the POST once', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    nock(LAUNCH_HUB_URL).matchHeader('x-project-uid', PROJECT_UID).get(ENV_PATH).reply(200, getFixture);
    let posts = 0;
    nock(LAUNCH_HUB_URL)
      .post(PURGE_PATH)
      .times(2)
      .reply(() => {
        posts += 1;
        return [403, { errors: [{ code: 'launch.FORBIDDEN', message: 'Forbidden' }], status: 403 }];
      });

    const { error } = await runCommand(purgeArgs('--env', ENV_UID, '--tags', 'a'), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('Purging the CDN cache needs permission to update the environment.');
    expect(posts).toBe(1);
    expect(onWire).toEqual([]);
  });

  it('exits 2 with the not-found wording for an environment uid from another project, and sends no POST', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const lookup = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments/${FOREIGN_ENV_UID}`)
      .reply(404, notFoundFixture);
    const purge = nock(LAUNCH_HUB_URL).post(`/manage/projects/${PROJECT_UID}/environments/${FOREIGN_ENV_UID}/revalidate-cdn-cache`).reply(200, INITIATED);

    const { error } = await runCommand(purgeArgs('--env', FOREIGN_ENV_UID, '--path', '/blog'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No environment with UID "${FOREIGN_ENV_UID}" found in this project.`);
    expect([lookup.isDone(), purge.isDone()]).toEqual([true, false]);
    expect(onWire).toEqual([]);
  });

  it('exits 2 with the not-found wording for an environment name the project does not have, before any lookup or POST', async () => {
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID);
    const scan = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}/environments`)
      .query({ limit: '100', skip: '0' })
      .reply(200, SCANNED);
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(purgeArgs('--env', 'staging-eu', '--path', '/blog'), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No environment named "staging-eu" found in this project.');
    expect(scan.isDone()).toBe(true);
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
  });

  it('exits 2 with the not-found wording when the project belongs to another organization, before any environment request', async () => {
    const ownership = projectOwnership(LAUNCH_HUB_URL, OTHER_ORG_UID, PROJECT_UID);
    const { lookup, purge } = lookupAndPurge({});

    const { error } = await runCommand(
      ['launch:cache:purge', '--org', OTHER_ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR, '--env', ENV_UID, '--path', '/blog'],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`No project with UID "${PROJECT_UID}" found in this organization.`);
    expect(ownership.isDone()).toBe(true);
    expect([lookup.isDone(), purge.isDone()]).toEqual([false, false]);
  });
});
