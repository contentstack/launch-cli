import open from 'open';

import Open from '../../../src/commands/launch/open';
import { cma, fixtures, prompts, runCommand, Session, startSession } from '../harness';

const openMock = open as unknown as jest.Mock;

describe('launch:open', () => {
  let session: Session;

  beforeEach(async () => {
    openMock.mockClear();
    session = await startSession();
    cma.withOrganizations([fixtures.ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  it('opens the deployment recorded in .cs-launch.json without calling the API', async () => {
    await session.stop();
    session = await startSession({ launchConfigFile: fixtures.existingProjectConfigFile() });

    prompts.script([]);

    const result = await runCommand(Open, session.baseArgs);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(session.api.calls()).toHaveLength(0);
    expect(openMock).toHaveBeenCalledWith(`https://${fixtures.DEPLOYMENT_URL}`);
    expect(result.output).toContain(`https://${fixtures.DEPLOYMENT_URL}`);
  });

  it('resolves the environment through the API when --environment is given', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on('Environments', fixtures.environmentsResponse());

    prompts.script([]);

    const result = await runCommand(Open, [
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
    expect(session.api.operationSequence()).toEqual(['Projects', 'Environments']);
    expect(openMock).toHaveBeenCalledWith(`https://${fixtures.DEPLOYMENT_URL}`);
  });

  it('exits non-zero when the environment has no deployment to open', async () => {
    session.api.on('Projects', fixtures.projectsResponse()).on(
      'Environments',
      fixtures.environmentsResponse([
        fixtures.environmentNode({
          deployments: { __typename: 'DeploymentConnection', edges: [] },
        }),
      ]),
    );

    prompts.script([]);

    const result = await runCommand(Open, [
      ...session.baseArgs,
      '--org',
      fixtures.ORG.uid,
      '--project',
      fixtures.PROJECT_UID,
      '--environment',
      fixtures.ENVIRONMENT_NAME,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Website URL not found');
    expect(openMock).not.toHaveBeenCalled();
  });
});
