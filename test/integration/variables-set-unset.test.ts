import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHandler, configHandler } from '@contentstack/cli-utilities';
import type { Interfaces } from '@oclif/core';
import { runCommand } from '@oclif/test';
import nock from 'nock';

import cmsFixture from '../fixtures/cms-environment-variables.json';
import getFixture from '../fixtures/environment-get.json';
import { answerPrompts, onTerminal } from '../support/terminal';
import { loadCliConfig, routeConsoleLogToStdout } from '../support/oclif';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ENV_UID = 'd4e5f60718293a4b5c6d7e8f';
const ENV_PATH = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}`;

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

const SCOPE = ['--org', ORG_UID, '--project', PROJECT_UID, '--env', ENV_UID];

interface Wire {
  order: string[];
  patch: unknown[];
}

function scopedHub() {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .matchHeader('x-project-uid', PROJECT_UID)
    .matchHeader('x-cs-api-version', '1.0');
}

function patchEndpoint(wire: Wire, status = 200, body: unknown = undefined) {
  return scopedHub()
    .patch(`${ENV_PATH}/variables`, (sent) => {
      wire.order.push('patch');
      wire.patch.push(sent);
      return true;
    })
    .reply(status, () => {
      if (body !== undefined) {
        return body;
      }

      const sent = wire.patch[wire.patch.length - 1] as { set?: { key: string }[] };

      return {
        environment: {
          uid: ENV_UID,
          updatedAt: getFixture.environment.updatedAt,
          environmentVariables: (sent.set ?? []).map(({ key }) => ({ key })),
        },
      };
    });
}

function unsetEndpoints(wire: Wire, status = 200, body: unknown = undefined) {
  scopedHub()
    .get(ENV_PATH)
    .reply(200, () => {
      wire.order.push('get');
      return getFixture;
    });

  return patchEndpoint(wire, status, body);
}

function cmsEndpoint(sent: Wire) {
  return nock(LAUNCH_HUB_URL)
    .matchHeader('x-organization-uid', ORG_UID)
    .get('/manage/cms/environment-variables')
    .reply(200, () => {
      sent.order.push('cms');
      return cmsFixture;
    });
}

function wire(): Wire {
  return { order: [], patch: [] };
}

describe('integration: launch:variables:set and :unset driven through oclif runCommand', () => {
  let workDir: string;

  beforeAll(async () => {
    config = await loadCliConfig();
  });

  beforeEach(() => {
    process.exitCode = 0;
    workDir = mkdtempSync(join(tmpdir(), 'launch-variables-'));
    routeConsoleLogToStdout();
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => CONFIG[key]);
    jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = 0;
    rmSync(workDir, { recursive: true, force: true });
    nock.cleanAll();
  });

  afterAll(() => {
    process.exitCode = 0;
    nock.restore();
  });

  it('patches only the variables it was given, without reading the environment first', async () => {
    const sent = wire();
    const scope = patchEndpoint(sent);

    const { error, stdout } = await runCommand(
      ['launch:variables:set', ...SCOPE, '--var', 'API_URL=https://example.test', 'DEBUG=true', '--data-dir', workDir],
      config,
    );

    expect(error).toBeUndefined();
    expect(scope.isDone()).toBe(true);
    expect(sent.order).toEqual(['patch']);
    expect(sent.patch).toEqual([
      { set: [{ key: 'API_URL', value: 'https://example.test' },
        { key: 'DEBUG', value: 'true' },
      ],
      },
    ]);
    expect(stdout).toContain('\u2714 2 variables set \u2014 2 from --var');
    expect(stdout).not.toContain('https://example.test');
    expect(stdout).not.toContain('value1');
  });

  it('keeps every other variable when a single key is set and replaces a key that already exists', async () => {
    const sent = wire();
    patchEndpoint(sent);

    const { error } = await runCommand(['launch:variables:set', ...SCOPE, '--var', 'key1=changed', '--data-dir', workDir], config);

    expect(error).toBeUndefined();
    expect(sent.patch).toEqual([{ set: [{ key: 'key1', value: 'changed' }] }]);
  });

  it('stops --var at the next flag so --project is not swallowed as a value', async () => {
    const sent = wire();
    patchEndpoint(sent);

    const { error } = await runCommand(
      ['launch:variables:set', '--org', ORG_UID, '--var', 'A=1', 'B=2', '--project', PROJECT_UID, '--env', ENV_UID, '--data-dir', workDir],
      config,
    );

    expect(error).toBeUndefined();
    expect(sent.patch).toEqual([
      { set: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] },
    ]);
  });

  it('splits on the first equals sign and keeps a quoted value with a space whole', async () => {
    const sent = wire();
    patchEndpoint(sent);

    const { error } = await runCommand(['launch:variables:set', ...SCOPE, '--var', 'TOKEN=a=b', '"MSG=hello world"', '--data-dir', workDir], config);

    expect(error).toBeUndefined();
    expect(sent.patch).toEqual([
      { set: [{ key: 'TOKEN', value: 'a=b' },
        { key: 'MSG', value: 'hello world' },
      ],
      },
    ]);
  });

  it('reads a named dotenv file, lets --var win a collision and names the override', async () => {
    const sent = wire();
    patchEndpoint(sent);
    const file = join(workDir, 'staging.env');
    writeFileSync(file, 'API_URL=from-file\nFROM_FILE=1\n');

    const { error, stdout } = await runCommand(
      ['launch:variables:set', ...SCOPE, '--dotenv', file, '--var', 'API_URL=typed', '--data-dir', workDir],
      config,
    );

    expect(error).toBeUndefined();
    expect(sent.patch).toEqual([
      { set: [{ key: 'API_URL', value: 'typed' },
        { key: 'FROM_FILE', value: '1' },
      ],
      },
    ]);
    expect(stdout).toContain(`2 variables set \u2014 2 from ${file}, API_URL overridden by --var`);
  });

  it('auto-detects .env.local under --data-dir with no source flag and names the file it chose', async () => {
    const sent = wire();
    patchEndpoint(sent);
    writeFileSync(join(workDir, '.env.local'), 'LOCAL=1\n');
    writeFileSync(join(workDir, '.env'), 'OTHER=2\n');

    const { error, stdout } = await runCommand(['launch:variables:set', ...SCOPE, '--data-dir', workDir], config);

    expect(error).toBeUndefined();
    expect(stdout).toContain(`Using variables from ${join(workDir, '.env.local')}.`);
    expect(sent.patch).toEqual([{ set: [{ key: 'LOCAL', value: '1' }] }]);
  });

  it('exits 2 naming --dotenv and --data-dir when nothing is given and nothing is detected, sending no request', async () => {
    const sent = wire();
    const scope = patchEndpoint(sent);

    const { error } = await runCommand(['launch:variables:set', ...SCOPE, '--data-dir', workDir], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toMatch(/--dotenv.*--data-dir/);
    expect(sent.order).toEqual([]);
    expect(scope.isDone()).toBe(false);
  });

  it('exits 0 with no changes made and sends no request when the file holds nothing', async () => {
    const sent = wire();
    patchEndpoint(sent);
    const file = join(workDir, 'empty.env');
    writeFileSync(file, '# nothing\n');

    const { error, stdout } = await runCommand(['launch:variables:set', ...SCOPE, '--dotenv', file, '--data-dir', workDir], config);

    expect(error).toBeUndefined();
    expect(stdout).toContain('No changes made.');
    expect(sent.order).toEqual([]);
  });

  it('asks which sources to use on a terminal when none was given, then sets what was typed', async () => {
    const sent = wire();
    const scope = patchEndpoint(sent);
    const prompts = answerPrompts({
      'Add variables from': ['Type KEY=VALUE pairs'],
      'KEY=VALUE pairs separated by spaces': 'API_URL=typed-value DEBUG=true',
    });

    const { error, stdout } = await onTerminal(() =>
      runCommand(['launch:variables:set', ...SCOPE, '--data-dir', workDir], config),
    );

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual(['Add variables from', 'KEY=VALUE pairs separated by spaces']);
    expect(prompts.payloads[0]).toMatchObject({ type: 'checkbox' });
    expect((prompts.payloads[0].choices as { value: string }[]).map((choice) => choice.value)).toEqual([
      'Import variables from a stack',
      'Import variables from a dotenv file',
      'Type KEY=VALUE pairs',
    ]);
    expect(scope.isDone()).toBe(true);
    expect(sent.patch).toEqual([
      { set: [{ key: 'API_URL', value: 'typed-value' },
        { key: 'DEBUG', value: 'true' },
      ],
      },
    ]);
    expect(stdout).toContain('2 variables set \u2014 2 from --var');
    expect(stdout).not.toContain('typed-value');
  });

  it('names the detected dotenv file in the checklist and reads the path it is given', async () => {
    const sent = wire();
    patchEndpoint(sent);
    writeFileSync(join(workDir, '.env.local'), 'FROM_FILE=1\n');
    const prompts = answerPrompts({
      'Add variables from': ['Import variables from a dotenv file'],
      'Path to the dotenv file': join(workDir, '.env.local'),
    });

    const { error } = await onTerminal(() =>
      runCommand(['launch:variables:set', ...SCOPE, '--data-dir', workDir], config),
    );

    expect(error).toBeUndefined();
    expect((prompts.payloads[0].choices as { name: string }[])[1].name).toBe(
      'Import variables from a dotenv file (.env.local found)',
    );
    expect(sent.patch).toEqual([
      { set: [{ key: 'FROM_FILE', value: '1' }] },
    ]);
  });

  it('exits 0 saying it skipped adding variables, and sends no request, when nothing is ticked on a terminal', async () => {
    const sent = wire();
    const scope = patchEndpoint(sent);
    answerPrompts({ 'Add variables from': [] });

    const { error, stdout } = await onTerminal(() =>
      runCommand(['launch:variables:set', ...SCOPE, '--data-dir', workDir], config),
    );

    expect(error).toBeUndefined();
    expect(stdout).toContain('Skipped adding variables.');
    expect(sent.order).toEqual([]);
    expect(scope.isDone()).toBe(false);
  });

  it('does not ask on a terminal when a source flag was given', async () => {
    const sent = wire();
    patchEndpoint(sent);
    const prompts = answerPrompts({});

    const { error } = await onTerminal(() =>
      runCommand(['launch:variables:set', ...SCOPE, '--var', 'A=1', '--data-dir', workDir], config),
    );

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual([]);
  });

  it('exits 2 for two bare keys without a terminal, naming --dotenv -, and sends no request', async () => {
    const sent = wire();
    patchEndpoint(sent);

    const { error } = await runCommand(['launch:variables:set', ...SCOPE, '--var', 'A', 'B', '--data-dir', workDir], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--dotenv -');
    expect(sent.order).toEqual([]);
  });

  it('asks a hidden prompt for a bare key on a terminal and never prints what was typed', async () => {
    const sent = wire();
    patchEndpoint(sent);
    const prompts = answerPrompts({ 'Value for API_KEY': 'never-printed-typed-value' });

    const { error, stdout } = await onTerminal(() =>
      runCommand(['launch:variables:set', ...SCOPE, '--var', 'API_KEY', '--data-dir', workDir], config),
    );

    expect(error).toBeUndefined();
    expect(prompts.messages).toEqual(['Value for API_KEY']);
    expect(prompts.payloads[0]).toMatchObject({ type: 'password', mask: '*' });
    expect(sent.patch).toEqual([
      { set: [{ key: 'API_KEY', value: 'never-printed-typed-value' }] },
    ]);
    expect(stdout).not.toContain('never-printed-typed-value');
  });

  it('exits 2 for an empty value before any request is sent', async () => {
    const sent = wire();
    patchEndpoint(sent);

    const { error } = await runCommand(['launch:variables:set', ...SCOPE, '--var', 'KEY=', '--data-dir', workDir], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('KEY has an empty value. The Launch API does not accept one.');
    expect(sent.order).toEqual([]);
  });

  it('exits 1 with the CLI wording and echoes neither the request body nor any value when the PATCH is refused', async () => {
    const sent = wire();
    patchEndpoint(sent, 400, {
      errors: [
        {
          code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.BYTE_SIZE_LIMIT_REACHED',
          message: 'API_URL=never-printed-value exceeds the size limit',
        },
      ],
      status: 400,
    });

    const { error, stdout } = await runCommand(
      ['launch:variables:set', ...SCOPE, '--var', 'API_URL=never-printed-value', '--data-dir', workDir],
      config,
    );

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(
      'The environment variables are larger than Launch allows. Remove some variables or shorten their values.',
    );
    expect(`${error?.message}${error?.stack ?? ''}${stdout}`).not.toContain('never-printed-value');
    expect(stdout).not.toContain('variables set');
  });

  it('exits 1 telling the user to run set again when another writer changed the variables first', async () => {
    const sent = wire();
    patchEndpoint(sent, 409, {
      errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE' }],
      status: 409,
    });

    const { error, stdout } = await runCommand(['launch:variables:set', ...SCOPE, '--var', 'A=1', '--data-dir', workDir], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toBe(
      "Another change to this environment's variables landed at the same moment, so nothing was changed. Run the command again.",
    );
    expect(stdout).not.toContain('variables set');
  });

  it('exits 1 with the same advice when unset loses the race, and does not report the key as removed', async () => {
    const sent = wire();
    unsetEndpoints(sent, 409, {
      errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE' }],
      status: 409,
    });

    const { error, stdout } = await runCommand(['launch:variables:unset', ...SCOPE, '--key', 'key1', '--yes'], config);

    expect(error?.oclif?.exit).toBe(1);
    expect(error?.message).toContain('Run the command again.');
    expect(stdout).not.toContain('removed');
  });

  it('exits 2 with the not-set wording when the key is gone by the time the PATCH lands', async () => {
    const sent = wire();
    unsetEndpoints(sent, 404, {
      errors: [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_FOUND' }],
      status: 404,
    });

    const { error, stdout } = await runCommand(['launch:variables:unset', ...SCOPE, '--key', 'key1', '--yes'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('key1 is not set in this environment.');
    expect(stdout).not.toContain('removed');
  });

  it('removes only the named key with --yes, patching out only that key', async () => {
    const sent = wire();
    unsetEndpoints(sent);

    const { error, stdout } = await runCommand(['launch:variables:unset', ...SCOPE, '--key', 'key1', '--yes'], config);

    expect(error).toBeUndefined();
    expect(sent.order).toEqual(['get', 'patch']);
    expect(sent.patch).toEqual([{ unset: ['key1'] }]);
    expect(stdout).toContain('\u2714 key1 removed from production.');
    expect(stdout).not.toContain('value1');
  });

  it('exits 2 for a key that is not set and sends no PATCH', async () => {
    const sent = wire();
    unsetEndpoints(sent);

    const { error } = await runCommand(['launch:variables:unset', ...SCOPE, '--key', 'NOPE', '--yes'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toBe('NOPE is not set in this environment.');
    expect(sent.order).toEqual(['get']);
  });

  it('exits 2 naming --yes without a terminal and sends no PATCH', async () => {
    const sent = wire();
    unsetEndpoints(sent);

    const { error } = await runCommand(['launch:variables:unset', ...SCOPE, '--key', 'key1'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('Pass --yes');
    expect(sent.order).toEqual(['get']);
  });

  it('exits 3 and sends no PATCH when the user declines', async () => {
    const sent = wire();
    unsetEndpoints(sent);
    answerPrompts({ 'Are you sure you want to remove key1 from "production"?': false });

    const { error, stdout } = await onTerminal(() =>
      runCommand(['launch:variables:unset', ...SCOPE, '--key', 'key1'], config),
    );

    expect(error?.oclif?.exit).toBe(3);
    expect(stdout).toContain('Variables not removed.');
    expect(sent.order).toEqual(['get']);
  });

  describe('with --from-stack', () => {
    const SAVED_TOKEN = randomBytes(16).toString('hex');

    beforeEach(() => {
      CONFIG.tokens = { 'my-prod': { token: SAVED_TOKEN, apiKey: 'blt9stackkey', environment: 'staging', type: 'delivery' } };
    });

    afterEach(() => {
      delete CONFIG.tokens;
    });

    it('imports through the saved alias, then patches the stack variables in', async () => {
      const sent = wire();
      cmsEndpoint(sent);
      patchEndpoint(sent);

      const { error, stdout } = await runCommand(
        ['launch:variables:set', ...SCOPE, '--from-stack', '-a', 'my-prod', '--data-dir', workDir],
        config,
      );

      expect(error).toBeUndefined();
      expect(sent.order).toEqual(['cms', 'patch']);
      expect(sent.patch).toEqual([
        { set: [{ key: 'CONTENTSTACK_API_HOST', value: 'api.integration.test' },
          { key: 'CONTENTSTACK_CDN', value: 'cdn.integration.test' },
          { key: 'CONTENTSTACK_API_KEY', value: 'blt9stackkey' },
          { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: SAVED_TOKEN },
          { key: 'CONTENTSTACK_ENVIRONMENT', value: 'staging' },
        ],
        },
      ]);
      expect(stdout).toContain('Using the saved delivery token "my-prod" (environment staging).');
      expect(stdout).toContain('5 variables set \u2014 5 from stack');
      expect(stdout).not.toContain(SAVED_TOKEN);
    });

    it('lets a typed --var override a stack value and names the override', async () => {
      const sent = wire();
      cmsEndpoint(sent);
      patchEndpoint(sent);

      const { error, stdout } = await runCommand(
        ['launch:variables:set', ...SCOPE, '--from-stack', '--alias', 'my-prod', '--var', 'CONTENTSTACK_ENVIRONMENT=production', '--data-dir', workDir],
        config,
      );

      expect(error).toBeUndefined();
      expect((sent.patch[0] as { set: { key: string; value: string }[] }).set.at(-1)).toEqual({
        key: 'CONTENTSTACK_ENVIRONMENT',
        value: 'production',
      });
      expect(stdout).toContain('CONTENTSTACK_ENVIRONMENT overridden by --var');
    });

    it('exits 2 naming --alias when there is no terminal and no alias, sending no request', async () => {
      const sent = wire();
      cmsEndpoint(sent);
      patchEndpoint(sent);

      const { error } = await runCommand(['launch:variables:set', ...SCOPE, '--from-stack', '--data-dir', workDir], config);

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toBe("--from-stack requires --alias when there's no TTY.");
      expect(sent.order).toEqual([]);
    });

    it('exits 2 for an alias nothing is saved under, sending no request', async () => {
      const sent = wire();
      cmsEndpoint(sent);
      patchEndpoint(sent);

      const { error } = await runCommand(
        ['launch:variables:set', ...SCOPE, '--from-stack', '--alias', 'gone', '--data-dir', workDir],
        config,
      );

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toContain('No delivery token is saved as "gone".');
      expect(sent.order).toEqual([]);
    });

    it('exits 2 when --alias is given without --from-stack, sending no request', async () => {
      const sent = wire();
      cmsEndpoint(sent);
      patchEndpoint(sent);

      const { error } = await runCommand(
        ['launch:variables:set', ...SCOPE, '--alias', 'my-prod', '--var', 'A=1', '--data-dir', workDir],
        config,
      );

      expect(error?.oclif?.exit).toBe(2);
      expect(error?.message).toBe('--alias is only used with --from-stack.');
      expect(sent.order).toEqual([]);
    });
  });

  it('exits 2 naming --key when none is given', async () => {
    const { error } = await runCommand(['launch:variables:unset', ...SCOPE, '--yes'], config);

    expect(error?.oclif?.exit).toBe(2);
    expect(error?.message).toContain('--key');
  });
});
