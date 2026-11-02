import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { authHandler, cliux, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import { DEFAULT_SECRET_IO } from '../../src/secrets/secret.value';
import { projectOwnership } from '../support/project-ownership';
import { gluedValue } from '../support/glued-value';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';
import { answerPrompts, onTerminal } from '../support/terminal';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const COLLECTION_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/secrets`;
const CODES = 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS';
const ADD_QUESTION = 'Are you sure you want to add the secret API_TOKEN?';
const REPLACE_QUESTION = 'Are you sure you want to replace the value of the secret API_TOKEN?';

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
let sent: { method: string; path: string; body: unknown }[];
let restoreStdin: (() => void) | undefined;

function setArgs(extra: string[] = [], key = 'API_TOKEN', before: string[] = []): string[] {
  return [
    'launch:secrets:set',
    '--org',
    ORG_UID,
    '--project',
    PROJECT_UID,
    '--env',
    ENV_UID,
    ...before,
    '--key',
    key,
    ...extra,
    '--data-dir',
    workDir,
  ];
}

function pipedStdin(stream: Readable): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');

  Object.defineProperty(process, 'stdin', { value: stream, configurable: true });

  return () => {
    Object.defineProperty(process, 'stdin', original as PropertyDescriptor);
  };
}

function pipe(text: string): void {
  restoreStdin = pipedStdin(Readable.from([text]));
}

function hub() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

function held(keys: string[]) {
  return hub()
    .get(COLLECTION_PATH)
    .reply(200, { secrets: keys.map((key) => ({ key, updatedAt: '2026-09-01T10:00:00.000Z' })), count: keys.length });
}

function posted(status = 201, body: unknown = { key: 'API_TOKEN', updatedAt: '2026-09-02T10:00:00.000Z' }) {
  return hub()
    .matchHeader('content-type', /application\/json/)
    .post(COLLECTION_PATH, (body_) => {
      sent.push({ method: 'POST', path: COLLECTION_PATH, body: body_ });
      return true;
    })
    .reply(status, body as nock.Body);
}

function put(status = 200, body: unknown = { key: 'API_TOKEN', updatedAt: '2026-09-02T10:00:00.000Z' }, key = 'API_TOKEN') {
  return hub()
    .matchHeader('content-type', /application\/json/)
    .put(`${COLLECTION_PATH}/${encodeURIComponent(key)}`, (body_) => {
      sent.push({ method: 'PUT', path: `${COLLECTION_PATH}/${encodeURIComponent(key)}`, body: body_ });
      return true;
    })
    .reply(status, body as nock.Body);
}

function filesIn(directory: string): string {
  return readdirSync(directory)
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
}

describe('integration: launch:secrets:set on the wire', () => {
  beforeAll(async () => {
    config = await loadCliConfig();
    nock.disableNetConnect();
  });

  beforeEach(() => {
    process.exitCode = 0;
    workDir = mkdtempSync(join(tmpdir(), 'launch-secrets-'));
    onWire = [];
    sent = [];
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
    restoreStdin?.();
    restoreStdin = undefined;
    rmSync(workDir, { recursive: true, force: true });
    nock.emitter.removeAllListeners('no match');
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('S1 reads the value piped on stdin, lists, then POSTs {key, value} as JSON with --yes and asks nothing', async () => {
    const value = randomUUID();
    pipe(`${value}\n`);
    const list = held(['OTHER']);
    const write = posted();

    const { error, stdout, stderr } = await runCommand(setArgs(['--yes']), config);

    expect(error).toBeUndefined();
    expect([list.isDone(), write.isDone()]).toEqual([true, true]);
    expect(sent).toEqual([{ method: 'POST', path: COLLECTION_PATH, body: { key: 'API_TOKEN', value } }]);
    expect(onWire).toEqual([]);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(stdout).toBe('✔ Secret API_TOKEN added.\n');
    expect(stdout + stderr).not.toContain(value);
  });

  it('S2 asks a masked prompt for the value and then the confirmation on a terminal, then POSTs', async () => {
    const value = randomUUID();
    const prompts = answerPrompts({ 'Value for API_TOKEN': value, [ADD_QUESTION]: true });
    const list = held([]);
    const write = posted();

    const { error, stdout } = await onTerminal(() => runCommand(setArgs(), config));

    expect(error).toBeUndefined();
    expect([list.isDone(), write.isDone()]).toEqual([true, true]);
    expect(prompts.messages).toEqual(['Value for API_TOKEN', ADD_QUESTION]);
    expect(prompts.payloads[0]).toMatchObject({ type: 'password', mask: '*' });
    expect(prompts.payloads[1]).toMatchObject({ type: 'confirm', default: false });
    expect(sent).toEqual([{ method: 'POST', path: COLLECTION_PATH, body: { key: 'API_TOKEN', value } }]);
    expect(stdout).toBe('✔ Secret API_TOKEN added.\n');
    expect(JSON.stringify(prompts.payloads[1])).not.toContain(value);
  });

  it('S3 PUTs {value} to the key path, and never POSTs, when the key is already a secret', async () => {
    const value = randomUUID();
    pipe(value);
    const list = held(['API_TOKEN']);
    const write = put();

    const { error, stdout } = await runCommand(setArgs(['--yes']), config);

    expect(error).toBeUndefined();
    expect([list.isDone(), write.isDone()]).toEqual([true, true]);
    expect(sent).toEqual([{ method: 'PUT', path: `${COLLECTION_PATH}/API_TOKEN`, body: { value } }]);
    expect(onWire).toEqual([]);
    expect(stdout).toBe('✔ Secret API_TOKEN updated.\n');
  });

  it('S3 encodes a key with special characters as one path segment on the PUT', async () => {
    const value = randomUUID();
    pipe(value);
    held(['A/B C']);
    const write = put(200, {}, 'A/B C');

    const { error } = await runCommand(setArgs(['--yes'], '"A/B C"'), config);

    expect(error).toBeUndefined();
    expect(write.isDone()).toBe(true);
    expect(sent[0].path).toBe(`${COLLECTION_PATH}/A%2FB%20C`);
  });

  it('S4 exits 3 and writes nothing when the confirmation is declined', async () => {
    const prompts = answerPrompts({ 'Value for API_TOKEN': randomUUID(), [ADD_QUESTION]: false });
    held([]);
    const write = posted();

    const { error, stdout } = await onTerminal(() => runCommand(setArgs(), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(prompts.messages).toEqual(['Value for API_TOKEN', ADD_QUESTION]);
    expect(write.isDone()).toBe(false);
    expect(sent).toEqual([]);
    expect(stdout).toBe('Secret not saved.\n');
  });

  it('S4 asks the replace question when the key is held, and a decline sends no PUT', async () => {
    const prompts = answerPrompts({ 'Value for API_TOKEN': randomUUID(), [REPLACE_QUESTION]: false });
    held(['API_TOKEN']);
    const write = put();

    const { error } = await onTerminal(() => runCommand(setArgs(), config));

    expect(error?.oclif?.exit).toBe(3);
    expect(prompts.messages).toEqual(['Value for API_TOKEN', REPLACE_QUESTION]);
    expect(write.isDone()).toBe(false);
  });

  it.each([['an empty pipe', ''], ['a lone newline', '\n'], ['only spaces', '   \n']])(
    'S5 exits 2 naming the key and sends no request for %s',
    async (_label, piped) => {
      pipe(piped);
      const list = held([]);
      const write = posted();

      const { error, stdout } = await runCommand(setArgs(['--yes']), config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toBe(
        'The value for API_TOKEN is empty. A secret needs a non-empty value; nothing was changed.',
      );
      expect([list.isDone(), write.isDone()]).toEqual([false, false]);
      expect(onWire).toEqual([]);
      expect(stdout).toBe('');
    },
  );

  it('S6 exits 2 naming --yes and reads neither stdin nor the API when the value is piped without --yes', async () => {
    const reads: string[] = [];

    restoreStdin = pipedStdin(
      new Readable({
        read() {
          reads.push('read');
          this.push(null);
        },
      }),
    );
    const list = held([]);
    const write = posted();

    const { error } = await runCommand(setArgs(), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Pass --yes when piping the value');
    expect(reads).toEqual([]);
    expect([list.isDone(), write.isDone()]).toEqual([false, false]);
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it.each([['NEXT_PUBLIC_API'], ['NUXT_PUBLIC_API'], ['VITE_API'], ['GATSBY_API'], ['PUBLIC_API']])(
    'S7 warns for %s before the write and still writes',
    async (key) => {
      pipe(randomUUID());
      held([]);
      const write = posted();

      const { error, stdout } = await runCommand(setArgs(['--yes'], key), config);

      expect(error).toBeUndefined();
      expect(write.isDone()).toBe(true);
      expect(stdout.split('\n')[0]).toContain(`Warning: ${key} starts with`);
      expect(stdout).toContain('inlined into client JavaScript at build time');
      expect(stdout).toContain(`✔ Secret ${key} added.`);
    },
  );

  it.each([['API_TOKEN'], ['MY_NEXT_PUBLIC_X']])('S7 prints no warning for %s', async (key) => {
    pipe(randomUUID());
    held([]);
    posted();

    const { stdout } = await runCommand(setArgs(['--yes'], key), config);

    expect(stdout).toBe(`✔ Secret ${key} added.\n`);
  });

  it.each([
    ['--value <value>', (v: string) => setArgs(['--value', v])],
    ['--value=<value>', (v: string) => setArgs([`--value=${v}`])],
    ['a positional <value> before --key', (v: string) => setArgs([], 'API_TOKEN', [v])],
    ['a positional <value> after --yes before --key', (v: string) => setArgs([], 'API_TOKEN', ['--yes', v])],
    ['-v<value>', (v: string) => setArgs([`-v${v}`])],
    ['-y<value> before --key', (v: string) => setArgs([], 'API_TOKEN', [`-y${v}`])],
  ])('S8 exits 2 with only the generic line, echoing nothing, for %s', async (_label, argvFor) => {
    const value = gluedValue();
    pipe('');
    const list = held([]);

    const { error, stdout, stderr } = await runCommand(argvFor(value), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Invalid arguments.');
    expect(`${error?.message}${error?.stack ?? ''}${stdout}${stderr}`).not.toContain(value);
    expect(list.isDone()).toBe(false);
    expect(onWire).toEqual([]);
  });

  it.each([
    ['a token after --key', (v: string) => setArgs([v])],
    ['--yes=<value> after --key', (v: string) => setArgs([`--yes=${v}`])],
  ])('S8 exits 2 without echoing %s, which oclif reads as a second key', async (_label, argvFor) => {
    const value = randomUUID();
    pipe('');
    const list = held([]);

    const { error, stdout, stderr } = await runCommand(argvFor(value), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('launch:secrets:set sets one secret at a time. Pass --key once.');
    expect(`${error?.message}${stdout}${stderr}`).not.toContain(value);
    expect(list.isDone()).toBe(false);
  });

  it.each([['.'], ['..']])('S5 rejects the key %j with exit 2 before reading stdin and sends no request', async (key) => {
    const reads: string[] = [];

    restoreStdin = pipedStdin(
      new Readable({
        read() {
          reads.push('read');
          this.push(randomUUID());
          this.push(null);
        },
      }),
    );
    const list = held([]);
    const write = posted();

    const { error } = await runCommand(setArgs(['--yes'], key), config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain(`"${key}"`);
    expect(reads).toEqual([]);
    expect([list.isDone(), write.isDone()]).toEqual([false, false]);
    expect(onWire).toEqual([]);
    expect(cliux.inquire).not.toHaveBeenCalled();
  });

  it('S5 sends a key with a slash as one encoded segment on a PUT', async () => {
    pipe(randomUUID());
    held(['a/../b']);
    const write = put(200, { key: 'a/../b', updatedAt: '2026-09-02T10:00:00.000Z' }, 'a/../b');

    const { error } = await runCommand(setArgs(['--yes'], '"a/../b"'), config);

    expect(error).toBeUndefined();
    expect(write.isDone()).toBe(true);
    expect(sent.map((request) => request.path)).toEqual([`${COLLECTION_PATH}/a%2F..%2Fb`]);
  });

  it('S8 exposes no --value flag in the command definition', async () => {
    const command = config.findCommand('launch:secrets:set');

    expect(Object.keys(command?.flags ?? {}).sort()).toEqual(['config', 'data-dir', 'env', 'key', 'org', 'project', 'yes']);
  });

  it.each([
    [
      'a 409 on a key that already exists as a secret or a variable',
      'add',
      409,
      { errors: [{ code: `${CODES}.KEY.CONFLICT`, message: 'raw conflict' }] },
      'A secret or a variable with that key already exists in this environment.',
    ],
    [
      'a 409 concurrent update',
      'add',
      409,
      { errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE', message: 'raw' }] },
      "Another change to this environment's variables and secrets landed at the same moment, so nothing was changed. Run the command again.",
    ],
    [
      'a 400 multiline value',
      'add',
      400,
      { errors: [{ code: `${CODES}.VALUE.MULTILINE`, message: 'raw multiline' }] },
      'A secret value must be a single line.',
    ],
    [
      'a 400 invalid key',
      'add',
      400,
      { errors: [{ key: { code: 'launch.ENVIRONMENT.KEY.INVALID', message: 'key must be a valid name' } }] },
      'key must be a valid name',
    ],
    [
      'a 403 on an add',
      'add',
      403,
      { errors: [{ code: 'launch.RBAC.FORBIDDEN', message: 'raw forbidden' }] },
      'You do not have permission to change the secrets of this environment.',
    ],
    [
      'a 404 environment not found on an add',
      'add',
      404,
      { errors: [{ code: 'launch.ENVIRONMENT.NOT_FOUND', message: 'raw missing' }] },
      'The project or environment was not found.',
    ],
    [
      'a 404 on a refresh of a key that is no longer a secret',
      'refresh',
      404,
      { errors: [{ code: `${CODES}.KEY.NOT_FOUND`, message: 'raw missing key' }] },
      'No secret with that key exists in this environment.',
    ],
    [
      'a 403 on a refresh',
      'refresh',
      403,
      { errors: [{ code: 'launch.RBAC.FORBIDDEN' }] },
      'You do not have permission to change the secrets of this environment.',
    ],
  ])('S9 exits 1 with the clear message for %s', async (_label, mode, status, body, message) => {
    const value = randomUUID();
    pipe(value);
    held(mode === 'refresh' ? ['API_TOKEN'] : []);
    if (mode === 'refresh') {
      put(status, body);
    } else {
      posted(status, body);
    }

    const { error, stdout, stderr } = await runCommand(setArgs(['--yes']), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(message);
    expect(stderr).toBe(`error: ${message}\n`);
    expect(stdout).toBe('');
    expect(sent).toHaveLength(1);
  });

  it('S9 redacts a value the server echoes in a 400 and S10 leaves it out of output and files', async () => {
    const value = randomUUID();
    pipe(value);
    held([]);
    posted(400, { errors: [{ code: 'launch.ENVIRONMENT.VALUE.INVALID', message: `value ${value} is not allowed` }] });

    const { error, stdout, stderr } = await runCommand(setArgs(['--yes']), config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe('value •••••• is not allowed');
    expect(`${error?.message}${error?.stack ?? ''}${stdout}${stderr}${filesIn(workDir)}`).not.toContain(value);
    expect(sent[0].body).toEqual({ key: 'API_TOKEN', value });
  });

  it('S10 leaves the value out of stdout, stderr and every file written to the data directory on success', async () => {
    const value = randomUUID();
    pipe(value);
    held(['API_TOKEN']);
    put();

    const { error, stdout, stderr } = await runCommand(setArgs(['--yes']), config);

    expect(error).toBeUndefined();
    expect(`${stdout}${stderr}${filesIn(workDir)}`).not.toContain(value);
  });

  it('S11 ends with a clear error and sends nothing when standard input never ends', async () => {
    const original = DEFAULT_SECRET_IO.stdinTimeoutMs;
    const stream = new Readable({ read() {} });

    restoreStdin = pipedStdin(stream);
    DEFAULT_SECRET_IO.stdinTimeoutMs = 50;
    const list = held([]);

    try {
      const { error } = await runCommand(setArgs(['--yes']), config);

      expect(error?.oclif?.exit).toBe(1);
      expect(error?.message).toContain('No value arrived on standard input within 1 second');
      expect(list.isDone()).toBe(false);
      expect(onWire).toEqual([]);
      expect(stream.destroyed).toBe(true);
    } finally {
      DEFAULT_SECRET_IO.stdinTimeoutMs = original;
    }
  });

  it.each([
    ['--org', ['--project', PROJECT_UID, '--env', ENV_UID]],
    ['--project', ['--org', ORG_UID, '--env', ENV_UID]],
    ['--env', ['--org', ORG_UID, '--project', PROJECT_UID]],
  ])('S12 exits 2 naming %s, prompting and sending nothing, when it is unresolved and there is no terminal', async (flag, scope) => {
    pipe(randomUUID());
    held([]);

    const { error } = await runCommand(['launch:secrets:set', ...scope, '--key', 'API_TOKEN', '--yes', '--data-dir', workDir], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain(`Missing required value for ${flag}`);
    expect(cliux.inquire).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('S13 uses the --org and --project flags over the uids stored in .cs-launch.json', async () => {
    pipe(randomUUID());
    writeFileSync(
      join(workDir, '.cs-launch.json'),
      JSON.stringify({ project: { uid: 'f'.repeat(24), organizationUid: 'blt0000000000000000' } }),
    );
    held([]);
    const write = posted();

    const { error, stdout } = await runCommand(setArgs(['--yes']), config);

    expect(error).toBeUndefined();
    expect(write.isDone()).toBe(true);
    expect(onWire).toEqual([]);
    expect(stdout).toBe('✔ Secret API_TOKEN added.\n');
    expect(stdout).not.toContain('.cs-launch.json');
  });
});
