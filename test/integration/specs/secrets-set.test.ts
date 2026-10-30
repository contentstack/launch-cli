import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

import SetSecret from '../../../src/commands/launch/secrets/set';
import { cma, fixtures, prompts, runCommand, startSession, stdin, Session } from '../harness';

describe('launch:secrets:set', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession();
    cma.withOrganizations([fixtures.ORG, fixtures.OTHER_ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  const scope = () => [
    ...session.baseArgs,
    '--org',
    fixtures.ORG.uid,
    '--project',
    fixtures.PROJECT_UID,
    '--environment',
    fixtures.ENVIRONMENT_NAME,
  ];

  const logFiles = () =>
    ['info.log', 'error.log']
      .map((name) => join(session.projectDir, 'logs', name))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

  it('adds a secret from piped stdin without any prompt when --yes is passed', async () => {
    const value = randomUUID();
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse([]))
      .on('AddEnvironmentSecret', fixtures.addEnvironmentSecretResponse());
    stdin.pipe(`${value}\n`);
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, '--yes']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
    expect(session.api.operationSequence()).toEqual(['Projects', 'EnvironmentSecrets', 'AddEnvironmentSecret']);
    expect(session.api.variablesOf('AddEnvironmentSecret')).toEqual({
      environment: { uid: fixtures.ENVIRONMENT_UID },
      secret: { key: fixtures.SECRET_KEY, value },
    });
    expect(result.output).not.toContain(value);
  });

  it('fails without any prompt or mutation when the value is piped and --environment is missing', async () => {
    const value = randomUUID();
    stdin.pipe(`${value}\n`);
    prompts.script([]);
    const args = [...session.baseArgs, '--org', fixtures.ORG.uid, '--project', fixtures.PROJECT_UID];

    const result = await runCommand(SetSecret, [...args, '--key', fixtures.SECRET_KEY, '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('--org, --project and --environment are required when the value is piped');
    expect(result.output).not.toContain(value);
    expect(session.api.operationSequence()).toEqual([]);
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
  });

  it('fails without any prompt or mutation when the value is piped and a branch would have to be chosen', async () => {
    const value = randomUUID();
    writeFileSync(
      session.launchConfigPath,
      JSON.stringify({ main: { uid: fixtures.PROJECT_UID }, develop: { uid: fixtures.PROJECT_UID } }),
    );
    stdin.pipe(`${value}\n`);
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Multiple branches are configured; pass --branch to choose one.');
    expect(result.output).not.toContain(value);
    expect(session.api.operationSequence()).toEqual([]);
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
  });

  it('refreshes an existing secret after a masked prompt and a confirmation in a terminal', async () => {
    const value = randomUUID();
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse())
      .on('RefreshEnvironmentSecret', fixtures.refreshEnvironmentSecretResponse());
    stdin.tty();
    prompts.script([
      { name: 'value', answer: value },
      { name: 'confirm', answer: true },
    ]);

    const result = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
    expect(session.api.operationSequence()).toEqual(['Projects', 'EnvironmentSecrets', 'RefreshEnvironmentSecret']);
    expect(session.api.variablesOf('RefreshEnvironmentSecret')).toEqual({
      environment: { uid: fixtures.ENVIRONMENT_UID },
      secret: { key: fixtures.SECRET_KEY, value },
    });
    expect(result.output).not.toContain(value);
  });

  it('rejects --value as a nonexistent flag without sending a mutation or echoing the value', async () => {
    const value = randomUUID();
    session.api.on('Projects', fixtures.projectsResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, '--value', value]);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Invalid arguments');
    expect(result.output).not.toContain(value);
    expect(session.api.calls('AddEnvironmentSecret')).toHaveLength(0);
    expect(session.api.calls('RefreshEnvironmentSecret')).toHaveLength(0);
  });

  it.each([
    ['a positional argument', (value: string) => [value]],
    ['a short flag glued to the value', (value: string) => [`-v${value}`]],
  ])('never echoes the value when it is given as %s', async (_label, extra) => {
    const value = randomUUID();
    session.api.on('Projects', fixtures.projectsResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, ...extra(value)]);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain(value);
    expect(result.error?.message ?? '').not.toContain(value);
    expect(result.error?.stack ?? '').not.toContain(value);
    expect(session.api.calls('AddEnvironmentSecret')).toHaveLength(0);
  });

  it('fails without any prompt or mutation when the value is piped and --org matches no organization', async () => {
    const value = randomUUID();
    stdin.pipe(`${value}\n`);
    prompts.script([]);
    const args = [...session.baseArgs, '--org', 'WRONG', '--project', fixtures.PROJECT_UID, '-e', fixtures.ENVIRONMENT_NAME];

    const result = await runCommand(SetSecret, [...args, '--key', fixtures.SECRET_KEY, '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Organization UID not found!');
    expect(result.output).not.toContain(value);
    expect(session.api.operationSequence()).toEqual([]);
    prompts.assertScriptFullyConsumed();
  });

  it('fails without any prompt or mutation when the value is piped and --project matches no project', async () => {
    const value = randomUUID();
    session.api.on('Projects', fixtures.projectsResponse());
    stdin.pipe(`${value}\n`);
    prompts.script([]);
    const args = [...session.baseArgs, '--org', fixtures.ORG.uid, '--project', 'WRONG', '-e', fixtures.ENVIRONMENT_NAME];

    const result = await runCommand(SetSecret, [...args, '--key', fixtures.SECRET_KEY, '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Project not found!');
    expect(result.output).not.toContain(value);
    expect(session.api.operationSequence()).toEqual(['Projects']);
    prompts.assertScriptFullyConsumed();
  });

  it('writes to the project named by --project instead of the one stored in .cs-launch.json', async () => {
    const value = randomUUID();
    writeFileSync(session.launchConfigPath, JSON.stringify(fixtures.existingProjectConfigFile()));
    session.api
      .on('Projects', fixtures.projectsResponse([{ uid: 'other-project-uid', name: 'Other project' }]))
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse([]))
      .on('AddEnvironmentSecret', fixtures.addEnvironmentSecretResponse());
    stdin.pipe(`${value}\n`);
    prompts.script([]);
    const args = [...session.baseArgs, '--org', fixtures.ORG.uid, '--project', 'other-project-uid', '-e', fixtures.ENVIRONMENT_NAME];

    const result = await runCommand(SetSecret, [...args, '--key', fixtures.SECRET_KEY, '--yes']);

    expect(result.exitCode).toBe(0);
    expect(session.api.headersOf('AddEnvironmentSecret')['x-project-uid']).toBe('other-project-uid');
    prompts.assertScriptFullyConsumed();
  });

  it('redacts the value when --value is passed with an equals sign', async () => {
    const value = randomUUID();
    session.api.on('Projects', fixtures.projectsResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, `--value=${value}`]);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain(value);
    expect(result.error?.message ?? '').not.toContain(value);
    expect(session.api.calls('AddEnvironmentSecret')).toHaveLength(0);
    expect(session.api.calls('RefreshEnvironmentSecret')).toHaveLength(0);
  });

  it('fails with a missing required flag error and no mutation when --key is absent', async () => {
    session.api.on('Projects', fixtures.projectsResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--yes']);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Missing required flag key');
    expect(session.api.calls('AddEnvironmentSecret')).toHaveLength(0);
    expect(session.api.calls('RefreshEnvironmentSecret')).toHaveLength(0);
  });

  it('shows the key conflict message and exits 1 when the API reports a key conflict', async () => {
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse([]))
      .on('AddEnvironmentSecret', fixtures.secretsFormErrorResponse(fixtures.SECRET_ERROR_CODES.keyConflict));
    stdin.pipe(randomUUID());
    prompts.script([]);

    const result = await runCommand(SetSecret, [...scope(), '--key', 'DB_URL', '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('The key DB_URL is already used by a variable or secret.');
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
  });

  it('never writes the value to the output or the log files on success or on a 400', async () => {
    const value = randomUUID();
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse([]))
      .on('AddEnvironmentSecret', (_variables, callIndex) =>
        callIndex === 0
          ? fixtures.addEnvironmentSecretResponse()
          : fixtures.secretsApiErrorResponse(400, `Invalid value ${value}`),
      );
    prompts.script([]);

    stdin.pipe(value);
    const success = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, '--yes']);
    stdin.pipe(value);
    const failure = await runCommand(SetSecret, [...scope(), '--key', fixtures.SECRET_KEY, '--yes']);

    expect(success.exitCode).toBe(0);
    expect(failure.exitCode).toBe(1);
    expect(success.output).not.toContain(value);
    expect(failure.output).not.toContain(value);
    expect(logFiles()).not.toContain(value);
  });
});
