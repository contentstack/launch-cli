import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { pretendTerminal } from '../support/terminal';

import getFixture from '../fixtures/project-get.json';
import listFixture from '../fixtures/projects-list.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const CMA_URL = 'https://cma.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const OTHER_ORG_UID = 'blt0a1b2c3d4e5f6a7b';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const DATA_DIR = tmpdir();
const ORGANIZATION_QUERY = { limit: '100', asc: 'name', include_count: 'true', skip: '0' };

const ORGANIZATIONS = {
  organizations: [
    { uid: OTHER_ORG_UID, name: 'Acme Staging' },
    { uid: ORG_UID, name: 'Acme Production' },
  ],
  count: 2,
};

const ORGANIZATION_PICKER = {
  type: 'search-list',
  name: 'organization',
  message: 'Choose an organization',
  choices: [
    { name: 'Acme Staging', value: OTHER_ORG_UID },
    { name: 'Acme Production', value: ORG_UID },
  ],
};

let config: Interfaces.Config;
let onWire: string[];

function session(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authorisationType: 'BASIC',
    authtoken: randomUUID(),
    region: {
      name: 'integration',
      cma: CMA_URL,
      cda: 'https://cda.integration.test',
      uiHost: 'https://app.integration.test',
      launchHubUrl: LAUNCH_HUB_URL,
    },
    ...extra,
  };
}

function useSession(values: Record<string, unknown>): void {
  jest.spyOn(configHandler, 'get').mockImplementation((key: string) => values[key]);
}

function answering(answers: unknown[]): unknown[] {
  const inquired: unknown[] = [];
  let index = 0;

  jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
    inquired.push(payload);
    const answer = answers[index];
    index += 1;
    return answer as never;
  });

  return inquired;
}

async function onTerminal(args: string[]) {
  const restore = pretendTerminal();

  try {
    return await runCommand(args, config);
  } finally {
    restore();
  }
}

describe('integration: the organization prompt', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    onWire = [];
    nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
      onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
    });
    jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
      process.stdout.write(`${String(message)}\n`);
    });
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

  it('asks projects:list for the organization by name on a terminal and lists the one chosen', async () => {
    const authtoken = randomUUID();
    useSession(session({ authtoken }));
    const inquired = answering([ORG_UID]);
    const organizations = nock(CMA_URL)
      .matchHeader('authtoken', authtoken)
      .get('/v3/organizations')
      .query(ORGANIZATION_QUERY)
      .reply(200, ORGANIZATIONS);
    const projects = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get('/manage/projects')
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);

    const { error, stdout } = await onTerminal(['launch:projects:list', '--data-dir', DATA_DIR]);

    expect(error).toBeUndefined();
    expect(organizations.isDone()).toBe(true);
    expect(projects.isDone()).toBe(true);
    expect(inquired).toEqual([ORGANIZATION_PICKER]);
    expect(stdout).toContain('sample-project');
    expect(onWire).toEqual([]);
  });

  it('asks projects:get for the organization before the project lookup it scopes', async () => {
    useSession(session());
    const inquired = answering([ORG_UID]);
    nock(CMA_URL).get('/v3/organizations').query(ORGANIZATION_QUERY).reply(200, ORGANIZATIONS);
    const fetch = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);

    const { error, stdout } = await onTerminal([
      'launch:projects:get',
      '--project',
      PROJECT_UID,
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error).toBeUndefined();
    expect(fetch.isDone()).toBe(true);
    expect(inquired).toEqual([ORGANIZATION_PICKER]);
    expect(stdout).toContain(`uid   ${PROJECT_UID}`);
    expect(onWire).toEqual([]);
  });

  it('asks projects:update for the organization and puts the change in the one chosen', async () => {
    useSession(session());
    const inquired = answering([ORG_UID]);
    nock(CMA_URL).get('/v3/organizations').query(ORGANIZATION_QUERY).reply(200, ORGANIZATIONS);
    const update = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .put(`/manage/projects/${PROJECT_UID}`, { name: 'Renamed Site' })
      .query({})
      .reply(200, { project: { uid: PROJECT_UID, name: 'Renamed Site' } });

    const { error } = await onTerminal([
      'launch:projects:update',
      '--project',
      PROJECT_UID,
      '--name',
      '"Renamed Site"',
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error).toBeUndefined();
    expect(update.isDone()).toBe(true);
    expect(inquired).toEqual([ORGANIZATION_PICKER]);
    expect(onWire).toEqual([]);
  });

  it('asks projects:delete for the organization, then confirms, then deletes in the one chosen', async () => {
    useSession(session());
    const inquired = answering([ORG_UID, true]);
    nock(CMA_URL).get('/v3/organizations').query(ORGANIZATION_QUERY).reply(200, ORGANIZATIONS);
    const lookup = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(200, getFixture);
    const remove = nock(LAUNCH_HUB_URL, { badheaders: ['content-type'] })
      .matchHeader('x-organization-uid', ORG_UID)
      .delete(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(204);

    const { error } = await onTerminal([
      'launch:projects:delete',
      '--project',
      PROJECT_UID,
      '--data-dir',
      DATA_DIR,
    ]);

    expect(error).toBeUndefined();
    expect(lookup.isDone()).toBe(true);
    expect(remove.isDone()).toBe(true);
    expect(inquired[0]).toEqual(ORGANIZATION_PICKER);
    expect(inquired[1]).toMatchObject({ type: 'confirm' });
    expect(onWire).toEqual([]);
  });

  it('uses the organization an OAuth session is scoped to without asking', async () => {
    useSession(
      session({
        authorisationType: 'OAUTH',
        oauthAccessToken: randomUUID(),
        oauthOrgUid: ORG_UID,
      }),
    );
    const inquired = answering([]);
    const scoped = nock(CMA_URL)
      .get(`/v3/organizations/${ORG_UID}`)
      .query(true)
      .reply(200, { organization: { uid: ORG_UID, name: 'Acme Production' } });
    const projects = nock(LAUNCH_HUB_URL)
      .matchHeader('x-organization-uid', ORG_UID)
      .get('/manage/projects')
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);

    const { error, stdout } = await onTerminal(['launch:projects:list', '--data-dir', DATA_DIR]);

    expect(error).toBeUndefined();
    expect(scoped.isDone()).toBe(true);
    expect(projects.isDone()).toBe(true);
    expect(inquired).toEqual([]);
    expect(stdout).toContain(
      `Using the organization your OAuth session is scoped to: Acme Production (${ORG_UID}).`,
    );
    expect(onWire).toEqual([]);
  });

  it('exits 1 in its own words when the organizations cannot be fetched, and calls Launch not at all', async () => {
    useSession(session());
    const inquired = answering([]);
    nock(CMA_URL)
      .get('/v3/organizations')
      .query(ORGANIZATION_QUERY)
      .reply(403, { error_message: 'You are not permitted to list organizations', error_code: 162 });

    const { error } = await onTerminal(['launch:projects:list', '--data-dir', DATA_DIR]);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(
      'Could not list your organizations: You are not permitted to list organizations. ' +
        'Pass --org with an organization UID.',
    );
    expect(inquired).toEqual([]);
    expect(onWire).toEqual([]);
  });

  it('still exits 2 naming --org without a terminal, with advice that works', async () => {
    useSession(session());
    const inquired = answering([]);

    const { error } = await runCommand(['launch:projects:list', '--data-dir', DATA_DIR], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      'Missing required value for --org. Pass --org, set it in .cs-launch.json, or run in an interactive terminal.',
    );
    expect(inquired).toEqual([]);
    expect(onWire).toEqual([]);
  });

  it('does not ask for the organization when --org is passed', async () => {
    useSession(session());
    const inquired = answering([]);
    const projects = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);

    const { error } = await onTerminal(['launch:projects:list', '--org', ORG_UID, '--data-dir', DATA_DIR]);

    expect(error).toBeUndefined();
    expect(projects.isDone()).toBe(true);
    expect(inquired).toEqual([]);
    expect(onWire).toEqual([]);
  });
});
