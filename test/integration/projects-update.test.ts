import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import { Config, Interfaces, Plugin } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import listFixture from '../fixtures/projects-list.json';
import notFoundFixture from '../fixtures/project-not-found.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
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

let config: Interfaces.Config;
let onWire: string[];

function recordWire(): void {
  onWire = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

describe('integration: launch:projects:update on the wire', () => {
  beforeAll(async () => {
    const plugin = new Plugin({ ignoreManifest: true, isRoot: true, root: process.cwd() });
    await plugin.load();
    config = await Config.load({ plugins: new Map([[plugin.name, plugin]]), root: process.cwd() });
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    recordWire();
    jest.spyOn(console, 'log').mockImplementation((message: unknown) => {
      process.stdout.write(`${String(message)}\n`);
    });
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

  it('puts only the supplied field in the PUT body and prints the one line that changed', async () => {
    const scope = nock(LAUNCH_HUB_URL)
      .put(`/manage/projects/${PROJECT_UID}`, { name: 'Renamed Site' })
      .query({})
      .reply(200, { project: { uid: PROJECT_UID, name: 'Renamed Site' } });

    const { error, stdout } = await runCommand(
      [
        'launch:projects:update',
        '--org',
        ORG_UID,
        '--project',
        PROJECT_UID,
        '--name',
        '"Renamed Site"',
        '--data-dir',
        DATA_DIR,
      ],
      config,
    );

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe('✔ name updated to "Renamed Site"\n');
    expect(onWire).toEqual([]);
  });

  it('puts both fields when both were supplied and prints one line each', async () => {
    const scope = nock(LAUNCH_HUB_URL)
      .put(`/manage/projects/${PROJECT_UID}`, { name: 'Renamed Site', description: 'A new blurb' })
      .query({})
      .reply(200, { project: { uid: PROJECT_UID, name: 'Renamed Site', description: 'A new blurb' } });

    const { error, stdout } = await runCommand(
      [
        'launch:projects:update',
        '--org',
        ORG_UID,
        '--project',
        PROJECT_UID,
        '--name',
        '"Renamed Site"',
        '--description',
        '"A new blurb"',
        '--data-dir',
        DATA_DIR,
      ],
      config,
    );

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe(['✔ name updated to "Renamed Site"', '✔ description updated to "A new blurb"', ''].join('\n'));
  });

  it('accepts a project name and updates the uid it resolves to', async () => {
    const lookup = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '100', skip: '0' })
      .reply(200, listFixture);
    const scope = nock(LAUNCH_HUB_URL)
      .put(`/manage/projects/${PROJECT_UID}`, { description: 'A new blurb' })
      .query({})
      .reply(200, { project: { uid: PROJECT_UID, name: 'sample-project', description: 'A new blurb' } });

    const { error, stdout } = await runCommand(
      [
        'launch:projects:update',
        '--org',
        ORG_UID,
        '--project',
        'sample-project',
        '--description',
        '"A new blurb"',
        '--data-dir',
        DATA_DIR,
      ],
      config,
    );

    expect(error).toBeUndefined();
    expect(lookup.isDone()).toBe(true);
    expect(scope.isDone()).toBe(true);
    expect(stdout).toBe('✔ description updated to "A new blurb"\n');
  });

  it('exits 2 without sending anything when neither --name nor --description was supplied', async () => {
    const scope = nock(LAUNCH_HUB_URL).put(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, {});

    const { error } = await runCommand(
      ['launch:projects:update', '--org', ORG_UID, '--project', PROJECT_UID, '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('Pass at least one of --name, --description; none was supplied.');
    expect(onWire).toEqual([]);
    expect(scope.isDone()).toBe(false);
    expect(nock.pendingMocks()).toHaveLength(1);
  });

  it('exits 2 without sending anything when --name is longer than the server allows', async () => {
    const scope = nock(LAUNCH_HUB_URL).put(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, {});

    const { error } = await runCommand(
      [
        'launch:projects:update',
        '--org',
        ORG_UID,
        '--project',
        PROJECT_UID,
        '--name',
        'n'.repeat(201),
        '--data-dir',
        DATA_DIR,
      ],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('--name must be 200 characters or fewer; that value is 201 characters.');
    expect(onWire).toEqual([]);
    expect(scope.isDone()).toBe(false);
  });

  it('exits 2 without sending anything when --description is longer than the server allows', async () => {
    const scope = nock(LAUNCH_HUB_URL).put(`/manage/projects/${PROJECT_UID}`).query({}).reply(200, {});

    const { error } = await runCommand(
      [
        'launch:projects:update',
        '--org',
        ORG_UID,
        '--project',
        PROJECT_UID,
        '--description',
        'd'.repeat(256),
        '--data-dir',
        DATA_DIR,
      ],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('--description must be 255 characters or fewer; that value is 256 characters.');
    expect(onWire).toEqual([]);
    expect(scope.isDone()).toBe(false);
  });

  it('sends a name of exactly the server limit rather than refusing it', async () => {
    const atLimit = 'n'.repeat(200);
    const scope = nock(LAUNCH_HUB_URL)
      .put(`/manage/projects/${PROJECT_UID}`, { name: atLimit })
      .query({})
      .reply(200, { project: { uid: PROJECT_UID, name: atLimit } });

    const { error } = await runCommand(
      ['launch:projects:update', '--org', ORG_UID, '--project', PROJECT_UID, '--name', atLimit, '--data-dir', DATA_DIR],
      config,
    );

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('exits 1 with the project wording when the API rejects a duplicate name', async () => {
    nock(LAUNCH_HUB_URL)
      .put(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(409, { errors: [{ code: 'launch.PROJECT.DUPLICATE_NAME', message: 'taken' }] });

    const { error } = await runCommand(
      ['launch:projects:update', '--org', ORG_UID, '--project', PROJECT_UID, '--name', 'taken', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('A project with that name already exists in this organization.');
  });

  it('exits 1 when the API does not know the project uid', async () => {
    nock(LAUNCH_HUB_URL).put(`/manage/projects/${PROJECT_UID}`).query({}).reply(404, notFoundFixture);

    const { error } = await runCommand(
      ['launch:projects:update', '--org', ORG_UID, '--project', PROJECT_UID, '--name', 'New', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('No project found with that name or UID.');
  });

  it('exits 2 naming a project name that does not exist in the organization', async () => {
    nock(LAUNCH_HUB_URL).get('/manage/projects').query({ limit: '100', skip: '0' }).reply(200, listFixture);

    const { error } = await runCommand(
      ['launch:projects:update', '--org', ORG_UID, '--project', 'ghost-site', '--name', 'New', '--data-dir', DATA_DIR],
      config,
    );

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('No project named "ghost-site" found in this organization.');
  });
});
