import ListSecrets from '../../../src/commands/launch/secrets/list';
import { cma, fixtures, prompts, runCommand, startSession, Session } from '../harness';

describe('launch:secrets:list', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession();
    cma.withOrganizations([fixtures.ORG, fixtures.OTHER_ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  const flags = () => [
    ...session.baseArgs,
    '--org',
    fixtures.ORG.uid,
    '--project',
    fixtures.PROJECT_UID,
    '--environment',
    fixtures.ENVIRONMENT_NAME,
  ];

  it('lists the secret keys of the environment named by --org, --project and --environment', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('EnvironmentSecrets', fixtures.environmentSecretsResponse());
    prompts.script([]);

    const result = await runCommand(ListSecrets, flags());

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();

    expect(session.api.operationSequence()).toEqual(['Projects', 'EnvironmentSecrets']);
    const headers = session.api.headersOf('EnvironmentSecrets');
    expect(headers.organization_uid).toBe(fixtures.ORG.uid);
    expect(headers['x-project-uid']).toBe(fixtures.PROJECT_UID);

    expect(result.output).toContain('KEY');
    expect(result.output).toContain('UPDATED');
    expect(result.output).toContain(fixtures.SECRET_KEY);
  });

  it('shows a clear permission message and no raw error when the API answers 403', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('EnvironmentSecrets', {
      errors: [
        {
          message: 'Forbidden resource',
          extensions: { exception: { status: 403, errorObject: { policy: 'raw-policy-detail' } } },
        },
      ],
    });
    prompts.script([]);

    const result = await runCommand(ListSecrets, flags());

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('You do not have permission to manage the secrets of this environment.');
    expect(result.output).not.toContain('raw-policy-detail');
    expect(result.output).not.toContain('Forbidden resource');
    session.api.assertNoUnhandledOperations();
    prompts.assertScriptFullyConsumed();
  });
});
