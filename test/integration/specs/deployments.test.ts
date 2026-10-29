import Deployments from '../../../src/commands/launch/deployments';
import { cma, fixtures, prompts, runCommand, Session, startSession } from '../harness';

describe('launch:deployments', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession();
    cma.withOrganizations([fixtures.ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  it('lists the deployments of the environment named by --environment', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('Environments', fixtures.environmentsResponse());

    prompts.script([]);

    const result = await runCommand(Deployments, [
      ...session.baseArgs,
      '--org',
      fixtures.ORG.uid,
      '--project',
      fixtures.PROJECT_UID,
      '--environment',
      fixtures.ENVIRONMENT_NAME,
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();

    expect(session.api.operationSequence()).toEqual(['Projects', 'Environments']);
    expect(result.output).toContain(fixtures.ENVIRONMENT_NAME);
    expect(result.output).toContain('initial commit');
    expect(result.output).toContain(`https://${fixtures.DEPLOYMENT_URL}`);
  });

  it('prompts for an environment when the flag is absent', async () => {
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on(
        'Environments',
        fixtures.environmentsResponse([
          fixtures.environmentNode(),
          fixtures.environmentNode({ uid: 'env-uid-2', name: 'preview' }),
        ]),
      );

    prompts.script([{ name: 'Environment', answer: 'preview' }]);

    const result = await runCommand(Deployments, [
      ...session.baseArgs,
      '--org',
      fixtures.ORG.uid,
      '--project',
      fixtures.PROJECT_UID,
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();
    expect(result.output).toContain('preview');
  });

  it('exits non-zero when the named environment does not exist', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('Environments', fixtures.environmentsResponse());

    prompts.script([]);

    const result = await runCommand(Deployments, [
      ...session.baseArgs,
      '--org',
      fixtures.ORG.uid,
      '--project',
      fixtures.PROJECT_UID,
      '--environment',
      'no-such-environment',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Environment(s) not found!');
    prompts.assertScriptFullyConsumed();
  });
});
