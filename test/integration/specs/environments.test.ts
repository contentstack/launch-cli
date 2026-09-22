import Environments from '../../../src/commands/launch/environments';
import { cma, fixtures, prompts, runCommand, startSession, Session } from '../harness';

describe('launch:environments', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession();
    cma.withOrganizations([fixtures.ORG, fixtures.OTHER_ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  it('lists the environments of the project named by --org and --project', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('Environments', fixtures.environmentsResponse());

    prompts.script([]);

    const result = await runCommand(Environments, [
      ...session.baseArgs,
      '--org',
      fixtures.ORG.uid,
      '--project',
      fixtures.PROJECT_UID,
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();

    expect(session.api.operationSequence()).toEqual(['Projects', 'Environments']);
    expect(session.api.variablesOf('Projects')).toEqual({ query: {} });

    const headers = session.api.headersOf('Environments');
    expect(headers.organization_uid).toBe(fixtures.ORG.uid);
    expect(headers['x-project-uid']).toBe(fixtures.PROJECT_UID);
    expect(headers.authtoken).toBe('integration-test-authtoken');

    expect(result.output).toContain(fixtures.ENVIRONMENT_UID);
    expect(result.output).toContain(fixtures.ENVIRONMENT_NAME);
    expect(result.output).toContain('Gatsby');
  });

  it('prompts for organization and project when neither flag is given', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('Environments', fixtures.environmentsResponse());

    prompts.script([
      { name: 'Organization', answer: fixtures.ORG.name },
      { name: 'Project', answer: fixtures.PROJECT_NAME },
    ]);

    const result = await runCommand(Environments, session.baseArgs);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();
    session.api.assertNoUnhandledOperations();

    expect(prompts.promptSequence()).toEqual(['Organization', 'Project']);
    expect(cma.calls()).toEqual([
      { method: 'organization.fetchAll', params: { limit: 100, asc: 'name', include_count: true, skip: 0 } },
    ]);
    expect(session.api.headersOf('Environments')['x-project-uid']).toBe(fixtures.PROJECT_UID);
  });

  it('reads org and project from .cs-launch.json without prompting', async () => {
    await session.stop();
    session = await startSession({
      launchConfigFile: {
        project: {
          uid: fixtures.PROJECT_UID,
          name: fixtures.PROJECT_NAME,
          organizationUid: fixtures.ORG.uid,
          projectType: 'GITPROVIDER',
        },
      },
    });
    session.api.on('Environments', fixtures.environmentsResponse());
    prompts.script([]);

    const result = await runCommand(Environments, session.baseArgs);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(prompts.promptSequence()).toEqual([]);
    expect(session.api.operationSequence()).toEqual(['Environments']);
    expect(session.api.headersOf('Environments')['x-project-uid']).toBe(fixtures.PROJECT_UID);
    expect(session.api.headersOf('Environments').organization_uid).toBe(fixtures.ORG.uid);
  });

  it('exits non-zero when the environments query fails', async () => {
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('Environments', { errors: [{ message: 'Environments are unavailable' }] });

    prompts.script([]);

    const result = await runCommand(Environments, [
      ...session.baseArgs,
      '--org',
      fixtures.ORG.uid,
      '--project',
      fixtures.PROJECT_UID,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Environments are unavailable');
    prompts.assertScriptFullyConsumed();
  });

  it('refuses to run and calls nothing when the user is not logged in', async () => {
    await session.stop();
    session = await startSession({ auth: 'NONE' });

    prompts.script([]);

    const result = await runCommand(Environments, session.baseArgs);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('You are not logged in');
    expect(session.api.calls()).toHaveLength(0);
    expect(cma.calls()).toHaveLength(0);
  });
});
