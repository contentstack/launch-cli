import { writeFileSync } from 'fs';

import UnsetSecret from '../../../src/commands/launch/secrets/unset';
import { cma, fixtures, prompts, runCommand, startSession, stdin, Session } from '../harness';

describe('launch:secrets:unset', () => {
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

  it('deletes every given key in order without any prompt when --yes is passed', async () => {
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse())
      .on('DeleteEnvironmentSecret', fixtures.deleteEnvironmentSecretResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(UnsetSecret, [...scope(), '--key', 'API_TOKEN', '--key', 'DB_PASSWORD', '--yes']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
    expect(session.api.operationSequence()).toEqual(['Projects', 'EnvironmentSecrets', 'DeleteEnvironmentSecret']);
    expect(session.api.calls('DeleteEnvironmentSecret').map((call) => call.variables)).toEqual([
      { environment: { uid: fixtures.ENVIRONMENT_UID }, secret: { key: 'API_TOKEN' } },
      { environment: { uid: fixtures.ENVIRONMENT_UID }, secret: { key: 'DB_PASSWORD' } },
    ]);
  });

  it('shows a not-found message naming the key and exits 1 when the API reports the secret missing', async () => {
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse())
      .on('DeleteEnvironmentSecret', fixtures.secretsFormErrorResponse(fixtures.SECRET_ERROR_CODES.notFound));
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(UnsetSecret, [...scope(), '--key', 'MISSING_KEY', '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('The secret MISSING_KEY was not found.');
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
  });

  it('fails with a missing required flag error and no delete when --key is absent', async () => {
    session.api.on('Projects', fixtures.projectsResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(UnsetSecret, [...scope(), '--yes']);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Missing required flag key');
    expect(session.api.calls('DeleteEnvironmentSecret')).toHaveLength(0);
  });

  it('fails fast without a prompt or delete when --yes is missing and stdin is not a terminal', async () => {
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse());
    prompts.script([]);

    const result = await runCommand(UnsetSecret, [...scope(), '--key', 'API_TOKEN']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('use --yes when not running in a terminal');
    expect(session.api.calls('DeleteEnvironmentSecret')).toHaveLength(0);
    prompts.assertScriptFullyConsumed();
  });

  it('uses --branch to pick the configuration of a multi-branch .cs-launch.json without prompting', async () => {
    const config = {
      ...fixtures.existingProjectConfigFile({}, 'main'),
      ...fixtures.existingProjectConfigFile({}, 'develop'),
    };
    writeFileSync(session.launchConfigPath, JSON.stringify(config));
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('EnvironmentSecrets', fixtures.environmentSecretsResponse())
      .on('DeleteEnvironmentSecret', fixtures.deleteEnvironmentSecretResponse());
    stdin.tty();
    prompts.script([]);

    const result = await runCommand(UnsetSecret, [...scope(), '--branch', 'develop', '--key', 'API_TOKEN', '--yes']);

    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();
  });
});
