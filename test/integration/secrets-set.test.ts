import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
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

const SET_BASE = [
  'launch:secrets:set',
  '--org',
  ORG_UID,
  '--project',
  PROJECT_UID,
  '--env',
  ENV_UID,
  '--data-dir',
  DATA_DIR,
];
const SET = [...SET_BASE, '--key', 'API_TOKEN'];
const CONFLICT_CODE = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.CONFLICT';

let config: Interfaces.Config;
let unmatched: string[];
let restoreStdin: (() => void) | undefined;

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

function existing(keys: string[]): nock.Scope {
  return hub()
    .get(SECRETS_PATH)
    .reply(200, { secrets: keys.map((key) => ({ key, updatedAt: '2026-09-01T10:00:00.000Z' })), count: keys.length });
}

function pipe(text: string): void {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor;

  Object.defineProperty(process, 'stdin', { value: Readable.from([text]), configurable: true });
  restoreStdin = () => Object.defineProperty(process, 'stdin', original);
}

describe('integration: launch:secrets:set driven through oclif runCommand', () => {
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
    restoreStdin?.();
    restoreStdin = undefined;
    process.exitCode = 0;
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.enableNetConnect();
    nock.restore();
  });

  it('T13: adds a piped value after reading the list, with the key and value in the POST body and no prompt', async () => {
    const value = randomUUID();
    const sent: unknown[] = [];
    const prompts = answerPrompts({});
    pipe(`${value}\n`);
    const list = existing([]);
    const post = hub()
      .post(SECRETS_PATH, (body) => {
        sent.push(body);
        return true;
      })
      .reply(201, { key: 'API_TOKEN', updatedAt: '2026-09-02T10:00:00.000Z' });

    const { error, stdout } = await runCommand([...SET, '--yes'], config);

    expect(error).toBeUndefined();
    expect(list.isDone()).toBe(true);
    expect(post.isDone()).toBe(true);
    expect(sent).toEqual([{ key: 'API_TOKEN', value }]);
    expect(prompts.messages).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(stdout).toBe('✔ Secret API_TOKEN added.\n');
  });

  it('T14: on a terminal asks for the value then the confirmation, and refreshes with a PUT because the key exists', async () => {
    const value = randomUUID();
    const sent: unknown[] = [];
    const prompts = answerPrompts({
      'Value for API_TOKEN': value,
      'Refresh the secret API_TOKEN in this environment? Its current value will be replaced.': true,
    });
    existing(['API_TOKEN']);
    const put = hub()
      .put(`${SECRETS_PATH}/API_TOKEN`, (body) => {
        sent.push(body);
        return true;
      })
      .reply(200, { key: 'API_TOKEN', updatedAt: '2026-09-02T10:00:00.000Z' });

    const { error, stdout } = await onTerminal(() => runCommand(SET, config));

    expect(error).toBeUndefined();
    expect(put.isDone()).toBe(true);
    expect(sent).toEqual([{ value }]);
    expect(prompts.payloads.map((payload) => payload.type)).toEqual(['password', 'confirm']);
    expect(prompts.payloads[0]).toMatchObject({ mask: '*' });
    expect(unmatched).toEqual([]);
    expect(stdout).toBe('✔ Secret API_TOKEN refreshed.\n');
    expect(stdout).not.toContain(value);
  });

  it('sends nothing and exits 3 when the confirmation is declined', async () => {
    answerPrompts({ 'Value for API_TOKEN': randomUUID(), 'Add the secret API_TOKEN to this environment?': false });
    existing([]);

    const { error, stdout } = await onTerminal(() => runCommand(SET, config));

    expect(error?.oclif?.exit).toBe(3);
    expect(stdout).toBe('Secret not changed.\n');
    expect(unmatched).toEqual([]);
  });

  it('exits 2 naming --yes without a terminal and never sends the POST', async () => {
    const value = randomUUID();
    pipe(value);
    existing([]);

    const { error, stdout } = await runCommand(SET, config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe(
      'Add the secret API_TOKEN to this environment? Pass --yes to confirm without an interactive terminal.',
    );
    expect(error?.message).not.toContain(value);
    expect(stdout).not.toContain(value);
    expect(unmatched).toEqual([]);
  });

  it('exits 1 saying no value was received on an empty pipe, and sends nothing', async () => {
    pipe('');
    existing([]);

    const { error } = await runCommand([...SET, '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('No value received on stdin');
    expect(unmatched).toEqual([]);
  });

  it('T15: refuses --value as a separate argument without echoing the value or sending anything', async () => {
    const value = randomUUID();

    const { error, stdout } = await runCommand([...SET, '--value', value, '--yes'], config);

    expect(error?.message).toBe('Nonexistent flag: --value\nSee more help with --help');
    expect(error?.oclif?.exit).toBeGreaterThan(0);
    expect(`${error?.message}${stdout}`).not.toContain(value);
    expect(unmatched).toEqual([]);
  });

  it('T16: refuses --value=<value> without echoing the value or sending anything', async () => {
    const value = randomUUID();

    const { error, stdout } = await runCommand([...SET, `--value=${value}`, '--yes'], config);

    expect(error?.message).toBe('Nonexistent flag: --value\nSee more help with --help');
    expect(error?.oclif?.exit).toBeGreaterThan(0);
    expect(`${error?.message}${stdout}`).not.toContain(value);
    expect(unmatched).toEqual([]);
  });

  it.each([
    ['before the flags', 2],
    ['after --key', 2],
    ['after --yes', 2],
  ])('refuses a value given as a positional argument %s without echoing it', async (place, exit) => {
    const value = randomUUID();
    const argv = {
      'before the flags': [SET[0], value, ...SET.slice(1), '--yes'],
      'after --key': [...SET, value, '--yes'],
      'after --yes': [...SET, '--yes', value],
    }[place] as string[];

    const { error, stdout } = await runCommand(argv, config);

    expect(error?.oclif?.exit).toBe(exit);
    expect(`${error?.message}${stdout}`).not.toContain(value);
    expect(unmatched).toEqual([]);
  });

  it('words an unexpected positional argument with the generic invalid-arguments message', async () => {
    const { error } = await runCommand([SET[0], randomUUID(), ...SET.slice(1), '--yes'], config);

    expect(error?.message).toBe(`${GENERIC_ARGUMENTS_MESSAGE}\nSee more help with --help`);
  });

  it('T17: exits 2 naming --key when it is missing, and sends nothing', async () => {
    const { error } = await runCommand([...SET_BASE, '--yes'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Missing required value for --key');
    expect(unmatched).toEqual([]);
  });

  it('exits 2 asking for exactly one key when --key is repeated, and sends nothing', async () => {
    const { error } = await runCommand([...SET, '--key', 'OTHER', '--yes'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('Pass exactly one --key.');
    expect(unmatched).toEqual([]);
  });

  it('prints the client-exposed warning for a public prefix and still adds the secret', async () => {
    pipe(randomUUID());
    existing([]);
    const post = hub().post(SECRETS_PATH).reply(201, { key: 'NEXT_PUBLIC_API_URL' });

    const { error, stdout } = await runCommand([...SET_BASE, '--key', 'NEXT_PUBLIC_API_URL', '--yes'], config);

    expect(error).toBeUndefined();
    expect(post.isDone()).toBe(true);
    expect(stdout).toBe(
      'Warning: NEXT_PUBLIC_API_URL starts with a client-exposed prefix, so its value is inlined into client ' +
        'JavaScript at build time and is visible to anyone who loads your site.\n' +
        '✔ Secret NEXT_PUBLIC_API_URL added.\n',
    );
  });

  it('T21: exits 1 naming the key when the API answers 409 because a variable already uses it', async () => {
    const value = randomUUID();
    pipe(value);
    existing([]);
    hub()
      .post(SECRETS_PATH)
      .reply(409, { errors: [{ code: CONFLICT_CODE, message: 'raw conflict' }], status: 409 });

    const { error, stdout } = await runCommand([...SET_BASE, '--key', 'DB_URL', '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('The key DB_URL is already used by a variable or a secret in this environment.');
    expect(`${error?.message}${stdout}`).not.toContain(value);
  });

  it('exits 1 with the concurrent-update advice on a 409 CONCURRENT_UPDATE', async () => {
    pipe(randomUUID());
    existing([]);
    hub()
      .post(SECRETS_PATH)
      .reply(409, { errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE' }], status: 409 });

    const { error } = await runCommand([...SET, '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(
      'The environment was changed by another request at the same moment. Run the command again.',
    );
  });

  it('exits 1 with the multi-line message on a 400 and never echoes the lines', async () => {
    pipe('line1\nline2');
    existing([]);
    hub()
      .post(SECRETS_PATH)
      .reply(400, { errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.VALUE.MULTILINE' }], status: 400 });

    const { error, stdout } = await runCommand([...SET, '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('Invalid value: a secret value cannot contain line breaks.');
    expect(`${error?.message}${stdout}`).not.toContain('line1');
  });

  it('exits 1 with the invalid-key message on a 400 key validation code', async () => {
    pipe(randomUUID());
    existing([]);
    hub()
      .post(SECRETS_PATH)
      .reply(400, {
        errors: [{ key: { code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.TOO_LONG', message: 'Bad request' } }],
        status: 400,
      });

    const { error } = await runCommand([...SET, '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('Invalid key: the key is too long.');
  });

  it('exits 1 with the permission message on a 403 from the list, before asking for a value', async () => {
    const prompts = answerPrompts({});
    hub()
      .get(SECRETS_PATH)
      .reply(403, { errors: [{ code: 'launch.AUTH.FORBIDDEN', message: 'raw' }], status: 403 });

    const { error } = await onTerminal(() => runCommand(SET, config));

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('You do not have permission to manage the secrets of this environment.');
    expect(prompts.messages).toEqual([]);
  });

  it('exits 1 naming the secret on a 404 from the refresh', async () => {
    pipe(randomUUID());
    existing(['API_TOKEN']);
    hub()
      .put(`${SECRETS_PATH}/API_TOKEN`)
      .reply(404, { errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND' }], status: 404 });

    const { error } = await runCommand([...SET, '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('The secret API_TOKEN was not found in this environment.');
  });

  it('T23: puts the value in no output on success or on a 400, and in none of the console calls', async () => {
    const value = randomUUID();
    const logged: string[] = [];
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));
    pipe(value);
    existing([]);
    hub().post(SECRETS_PATH).reply(201, { key: 'API_TOKEN', updatedAt: '2026-09-02' });

    const success = await runCommand([...SET, '--yes'], config);

    restoreStdin?.();
    pipe(value);
    existing([]);
    hub()
      .post(SECRETS_PATH)
      .reply(400, { errors: [{ code: 'launch.SOMETHING.NEW', message: 'rejected' }], status: 400 });

    const failure = await runCommand([...SET, '--yes'], config);

    expect(success.error).toBeUndefined();
    expect(failure.error?.oclif?.exit).toBe(1);
    for (const text of [
      success.stdout,
      success.stderr,
      failure.stdout,
      failure.stderr,
      failure.error?.message,
      ...logged,
    ]) {
      expect(text ?? '').not.toContain(value);
    }
  });
});
