import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { projectOwnership } from '../support/project-ownership';
import { gluedValue } from '../support/glued-value';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { answerPrompts, onTerminal } from '../support/terminal';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const SECRETS_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/secrets`;
const CODES = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS';
const QUESTION = 'Are you sure you want to remove the secret API_TOKEN from this environment?';
const TWO_QUESTION = 'Are you sure you want to remove the secrets API_TOKEN, DB_PASSWORD from this environment?';

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
let workDir: string;
let onWire: string[];
let deleted: string[];

function unsetArgs(keys: string[], extra: string[] = [], before: string[] = []): string[] {
  return [
    'launch:secrets:unset',
    '--org',
    ORG_UID,
    '--project',
    PROJECT_UID,
    '--env',
    ENV_UID,
    ...before,
    ...keys.flatMap((key) => ['--key', key]),
    ...extra,
    '--data-dir',
    workDir,
  ];
}

function hub() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

function removal(key: string, status = 204, body?: unknown) {
  const path = `${SECRETS_PATH}/${encodeURIComponent(key)}`;

  return hub()
    .delete(path)
    .reply(status, () => {
      deleted.push(path);
      return body as nock.Body;
    });
}

describe('integration: launch:secrets:unset on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    workDir = mkdtempSync(join(tmpdir(), 'launch-secrets-'));
    onWire = [];
    deleted = [];
    nock.emitter.on('no match', (request: { method?: string; path?: string }) => {
      onWire.push(`${request.method ?? 'UNKNOWN'} ${request.path ?? ''}`);
    });
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    projectOwnership(LAUNCH_HUB_URL, ORG_UID, PROJECT_UID).persist();
  });

  afterEach(() => {
    process.exitCode = 0;
    rmSync(workDir, { recursive: true, force: true });
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('U1 sends one bodyless DELETE per key, in the order given, with --yes and no prompt', async () => {
    const first = removal('DB_PASSWORD');
    const second = removal('API_TOKEN');

    const { error, stdout, stderr } = await runCommand(unsetArgs(['DB_PASSWORD', 'API_TOKEN'], ['--yes']), config);

    expect(error).toBeUndefined();
    expect([first.isDone(), second.isDone()]).toEqual([true, true]);
    expect(deleted).toEqual([`${SECRETS_PATH}/DB_PASSWORD`, `${SECRETS_PATH}/API_TOKEN`]);
    expect(onWire).toEqual([]);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(stdout).toBe('✔ Secret DB_PASSWORD removed.\n✔ Secret API_TOKEN removed.\n');
    expect(stderr).toBe('');
  });

  it('U1 sends no body and no content type on a DELETE', async () => {
    const seen: { body: string; contentType: unknown }[] = [];
    const scope = hub()
      .delete(`${SECRETS_PATH}/API_TOKEN`)
      .reply(204, function reply(_uri, requestBody) {
        seen.push({ body: String(requestBody), contentType: this.req.headers['content-type'] });
        return '';
      });

    const { error } = await runCommand(unsetArgs(['API_TOKEN'], ['--yes']), config);

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(seen).toEqual([{ body: '', contentType: undefined }]);
  });

  it('U2 asks the question on a terminal and deletes when it is accepted', async () => {
    const prompts = answerPrompts({ [QUESTION]: true });
    const write = removal('API_TOKEN');

    const { error, stdout } = await onTerminal(() => runCommand(unsetArgs(['API_TOKEN']), config));

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([QUESTION]);
    expect(prompts.payloads[0]).toMatchObject({ type: 'confirm', default: false });
    expect(write.isDone()).toBe(true);
    expect(stdout).toBe('✔ Secret API_TOKEN removed.\n');
  });

  it('U2 asks one question naming every key, and a decline exits 3 and sends no DELETE', async () => {
    const prompts = answerPrompts({ [TWO_QUESTION]: false });
    const first = removal('API_TOKEN');
    const second = removal('DB_PASSWORD');

    const { error, stdout } = await onTerminal(() => runCommand(unsetArgs(['API_TOKEN', 'DB_PASSWORD']), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(prompts.messages).toEqual([TWO_QUESTION]);
    expect([first.isDone(), second.isDone()]).toEqual([false, false]);
    expect(deleted).toEqual([]);
    expect(onWire).toEqual([]);
    expect(stdout).toBe('Secrets not removed.\n');
  });

  it('U3 exits 2 naming --yes, asking nothing and sending nothing, when there is no terminal and no --yes', async () => {
    const write = removal('API_TOKEN');

    const { error, stdout } = await runCommand(unsetArgs(['API_TOKEN']), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(`${QUESTION} Pass --yes to confirm without an interactive terminal.`);
    expect(write.isDone()).toBe(false);
    expect(deleted).toEqual([]);
    expect(onWire).toEqual([]);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(stdout).toBe('');
  });

  it('U4 names the key whose DELETE answered 404, still deletes the others in order and exits 1', async () => {
    const first = removal('A');
    const missing = removal('B', 404, { errors: [{ code: `${CODES}.KEY.NOT_FOUND`, message: 'raw missing key' }] });
    const third = removal('C');

    const { error, stdout, stderr } = await runCommand(unsetArgs(['A', 'B', 'C'], ['--yes']), config);

    expect(error?.oclif?.exit).toBe(1);
    expect([first.isDone(), missing.isDone(), third.isDone()]).toEqual([true, true, true]);
    expect(deleted).toEqual([`${SECRETS_PATH}/A`, `${SECRETS_PATH}/B`, `${SECRETS_PATH}/C`]);
    expect(stdout).toBe(
      '✔ Secret A removed.\n' +
        'Secret B was not removed: No secret with that key exists in this environment.\n' +
        '✔ Secret C removed.\n',
    );
    expect(error?.message).toBe('1 of 3 secrets were not removed: B.');
    expect(stderr).toBe('error: 1 of 3 secrets were not removed: B.\n');
    expect(stdout + stderr).not.toContain('raw missing key');
  });

  it('U4 names C as failed and D and E as not attempted when C hits a network failure, sending no DELETE for D or E', async () => {
    const first = removal('A');
    const second = removal('B');
    const broken = hub().delete(`${SECRETS_PATH}/C`).replyWithError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
    const fourth = removal('D');
    const fifth = removal('E');

    const { error, stdout, stderr } = await runCommand(unsetArgs(['A', 'B', 'C', 'D', 'E'], ['--yes']), config);

    expect(error?.oclif?.exit).toBe(1);
    expect([first.isDone(), second.isDone(), broken.isDone()]).toEqual([true, true, true]);
    expect([fourth.isDone(), fifth.isDone()]).toEqual([false, false]);
    expect(deleted).toEqual([`${SECRETS_PATH}/A`, `${SECRETS_PATH}/B`]);
    expect(onWire).toEqual([]);
    expect(stdout).toBe('✔ Secret A removed.\n✔ Secret B removed.\n');
    expect(error?.message).toContain('Stopped at secret C: ');
    expect(error?.message).toContain('\nRemoved: A, B.\nFailed: C.\nNot attempted: D, E.');
    expect(stderr).toContain('Not attempted: D, E.');
  });

  it.each([['.'], ['..']])('rejects the key %j with exit 2 before confirming and sends no request', async (key) => {
    const write = removal('API_TOKEN');

    const { error } = await runCommand(unsetArgs(['API_TOKEN', `"${key}"`], ['--yes']), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain(`"${key}"`);
    expect(write.isDone()).toBe(false);
    expect(deleted).toEqual([]);
    expect(onWire).toEqual([]);
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('U5 words a 403 as a permission failure for the key and exits 1', async () => {
    removal('API_TOKEN', 403, { errors: [{ code: 'launch.RBAC.FORBIDDEN', message: 'raw forbidden' }] });

    const { error, stdout } = await runCommand(unsetArgs(['API_TOKEN'], ['--yes']), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(stdout).toBe(
      'Secret API_TOKEN was not removed: You do not have permission to change the secrets of this environment.\n',
    );
    expect(error?.message).toBe('1 of 1 secret was not removed: API_TOKEN.');
    expect(stdout).not.toContain('raw forbidden');
  });

  it('U5 words an environment that is not found for the key and exits 1', async () => {
    removal('API_TOKEN', 404, { errors: [{ code: 'launch.ENVIRONMENT.NOT_FOUND' }] });

    const { error, stdout } = await runCommand(unsetArgs(['API_TOKEN'], ['--yes']), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(stdout).toBe('Secret API_TOKEN was not removed: The project or environment was not found.\n');
  });

  it('U6 exits 2 naming --key and sends nothing when no key is given', async () => {
    const write = removal('API_TOKEN');

    const { error } = await runCommand(unsetArgs([], ['--yes']), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--key');
    expect(write.isDone()).toBe(false);
    expect(onWire).toEqual([]);
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('U7 encodes a key with special characters as one path segment', async () => {
    const write = removal('A/B C?d=1#e%f');

    const { error, stdout } = await runCommand(unsetArgs(['"A/B C?d=1#e%f"'], ['--yes']), config);

    expect(error).toBeUndefined();
    expect(write.isDone()).toBe(true);
    expect(deleted).toEqual([`${SECRETS_PATH}/A%2FB%20C%3Fd%3D1%23e%25f`]);
    expect(stdout).toBe('✔ Secret A/B C?d=1#e%f removed.\n');
  });

  it.each([
    ['--value <token>', (v: string) => unsetArgs(['API_TOKEN'], ['--value', v, '--yes'])],
    ['--value=<token>', (v: string) => unsetArgs(['API_TOKEN'], [`--value=${v}`, '--yes'])],
    ['-v<token>', (v: string) => unsetArgs(['API_TOKEN'], [`-v${v}`, '--yes'])],
    ['a positional <token>', (v: string) => unsetArgs(['API_TOKEN'], ['--yes', '--', v])],
  ])('exits 2 with only the generic line, echoing nothing, for %s', async (_label, argvFor) => {
    const token = gluedValue();
    const write = removal('API_TOKEN');

    const { error, stdout, stderr } = await runCommand(argvFor(token), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Invalid arguments. Run csdx launch:secrets:unset --help');
    expect(`${error?.message}${error?.stack ?? ''}${stdout}${stderr}`).not.toContain(token);
    expect(write.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it.each([
    ['--org', ['--project', PROJECT_UID, '--env', ENV_UID]],
    ['--project', ['--org', ORG_UID, '--env', ENV_UID]],
    ['--env', ['--org', ORG_UID, '--project', PROJECT_UID]],
  ])('exits 2 naming %s, prompting and sending nothing, when it is unresolved and there is no terminal', async (flag, scope) => {
    removal('API_TOKEN');

    const { error } = await runCommand(['launch:secrets:unset', ...scope, '--key', 'API_TOKEN', '--yes', '--data-dir', workDir], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain(`Missing required value for ${flag}`);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('uses the --org and --project flags over the uids stored in .cs-launch.json', async () => {
    writeFileSync(
      join(workDir, '.cs-launch.json'),
      JSON.stringify({ project: { uid: 'f'.repeat(24), organizationUid: 'blt0000000000000000' } }),
    );
    const write = removal('API_TOKEN');

    const { error, stdout } = await runCommand(unsetArgs(['API_TOKEN'], ['--yes']), config);

    expect(error).toBeUndefined();
    expect(write.isDone()).toBe(true);
    expect(onWire).toEqual([]);
    expect(stdout).toBe('✔ Secret API_TOKEN removed.\n');
  });

  it('declares --key as repeatable secret keys in the command definition and no --value flag', async () => {
    const command = config.findCommand('launch:secrets:unset');

    expect(Object.keys(command?.flags ?? {}).sort()).toEqual(['config', 'data-dir', 'env', 'key', 'org', 'project', 'yes']);
    expect(command?.flags.key.description).toBe('Secret key, repeatable');
  });
});
