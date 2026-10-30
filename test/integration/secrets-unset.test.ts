import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { answerPrompts, onTerminal } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { GENERIC_ARGUMENTS_MESSAGE } from '../../src/secrets/secrets.redact';
import { projectOwnership } from '../support/project-ownership';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const SECRETS_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/secrets`;
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

const UNSET_BASE = [
  'launch:secrets:unset',
  '--org',
  ORG_UID,
  '--project',
  PROJECT_UID,
  '--env',
  ENV_UID,
  '--data-dir',
  DATA_DIR,
];
const UNSET = [...UNSET_BASE, '--key', 'API_TOKEN'];
const NOT_FOUND_CODE = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND';

let config: Interfaces.Config;
let unmatched: string[];

function recordUnmatched(): void {
  unmatched = [];
  nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
    unmatched.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
  });
}

function hub() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

describe('integration: launch:secrets:unset driven through oclif runCommand', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    routeConsoleLogToStdout();
    recordUnmatched();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID).persist();
  });

  afterEach(() => {
    process.exitCode = 0;
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.enableNetConnect();
    nock.restore();
  });

  it('T26: deletes two keys in order with --yes, one DELETE each, no body, no prompt and one line per key', async () => {
    const order: string[] = [];
    const prompts = answerPrompts({});
    const first = hub()
      .delete(`${SECRETS_PATH}/API_TOKEN`)
      .reply(204, () => {
        order.push('API_TOKEN');
      });
    const second = hub()
      .delete(`${SECRETS_PATH}/DB_URL`)
      .reply(204, () => {
        order.push('DB_URL');
      });

    const { error, stdout } = await runCommand([...UNSET, '--key', 'DB_URL', '--yes'], config);

    expect(error).toBeUndefined();
    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(true);
    expect(order).toEqual(['API_TOKEN', 'DB_URL']);
    expect(prompts.messages).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(stdout).toBe('✔ Secret API_TOKEN removed.\n✔ Secret DB_URL removed.\n');
  });

  it('percent-encodes a key that is not path-safe in the DELETE path', async () => {
    const delete1 = hub().delete(`${SECRETS_PATH}/A%2FB`).reply(204);

    const { error } = await runCommand([...UNSET_BASE, '--key', 'A/B', '--yes'], config);

    expect(error).toBeUndefined();
    expect(delete1.isDone()).toBe(true);
    expect(unmatched).toEqual([]);
  });

  it('asks on a terminal and deletes after a yes', async () => {
    const prompts = answerPrompts({
      'Remove the secret API_TOKEN from this environment? This cannot be undone.': true,
    });
    const del = hub().delete(`${SECRETS_PATH}/API_TOKEN`).reply(204);

    const { error, stdout } = await onTerminal(() => runCommand(UNSET, config));

    expect(error).toBeUndefined();
    expect(del.isDone()).toBe(true);
    expect(prompts.payloads.map((payload) => payload.type)).toEqual(['confirm']);
    expect(stdout).toBe('✔ Secret API_TOKEN removed.\n');
  });

  it('sends nothing and exits 3 when the confirmation is declined', async () => {
    answerPrompts({ 'Remove the secret API_TOKEN from this environment? This cannot be undone.': false });

    const { error, stdout } = await onTerminal(() => runCommand(UNSET, config));

    expect(error?.oclif?.exit).toBe(3);
    expect(stdout).toBe('Secrets not removed.\n');
    expect(unmatched).toEqual([]);
  });

  it('exits 2 naming --yes without a terminal and never sends the DELETE', async () => {
    const { error } = await runCommand(UNSET, config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      'Remove the secret API_TOKEN from this environment? This cannot be undone. ' +
        'Pass --yes to confirm without an interactive terminal.',
    );
    expect(unmatched).toEqual([]);
  });

  it('T27: exits 1 naming the missing key on a 404 and stops before the keys after it', async () => {
    hub().delete(`${SECRETS_PATH}/API_TOKEN`).reply(204);
    hub()
      .delete(`${SECRETS_PATH}/MISSING_KEY`)
      .reply(404, { errors: [{ code: NOT_FOUND_CODE, message: 'raw' }], status: 404 });

    const { error, stdout } = await runCommand(
      [...UNSET, '--key', 'MISSING_KEY', '--key', 'NEVER_REACHED', '--yes'],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('The secret MISSING_KEY was not found in this environment.');
    expect(stdout).toBe('✔ Secret API_TOKEN removed.\n');
    expect(unmatched).toEqual([]);
  });

  it('exits 1 with the permission message on a 403', async () => {
    hub()
      .delete(`${SECRETS_PATH}/API_TOKEN`)
      .reply(403, { errors: [{ code: 'launch.AUTH.FORBIDDEN', message: 'raw' }], status: 403 });

    const { error, stdout } = await runCommand([...UNSET, '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('You do not have permission to manage the secrets of this environment.');
    expect(stdout).toBe('');
  });

  it('T28: exits 2 naming --key when it is missing, and sends nothing', async () => {
    const { error } = await runCommand([...UNSET_BASE, '--yes'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --key');
    expect(unmatched).toEqual([]);
  });

  it('refuses --value as an unknown flag and does not echo it or send anything', async () => {
    const value = randomUUID();

    const { error, stdout } = await runCommand([...UNSET, `--value=${value}`, '--yes'], config);

    expect(error?.message).toBe('Nonexistent flag: --value\nSee more help with --help');
    expect(error?.oclif?.exit).toBeGreaterThan(0);
    expect(`${error?.message}${stdout}`).not.toContain(value);
    expect(unmatched).toEqual([]);
  });

  it('words a positional argument with the generic invalid-arguments message without echoing it', async () => {
    const value = randomUUID();

    const { error, stdout } = await runCommand([UNSET[0], value, ...UNSET.slice(1), '--yes'], config);

    expect(error?.message).toBe(`${GENERIC_ARGUMENTS_MESSAGE}\nSee more help with --help`);
    expect(`${error?.message}${stdout}`).not.toContain(value);
    expect(unmatched).toEqual([]);
  });
});
