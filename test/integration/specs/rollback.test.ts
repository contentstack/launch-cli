import Rollback from '../../../src/commands/launch/rollback';
import { cma, fixtures, prompts, runCommand, Session, startSession } from '../harness';

const LIVE_DEPLOYMENT_UID = 'deployment-uid-live';
const PREVIOUS_DEPLOYMENT_UID = 'deployment-uid-previous';

const environmentWithHistory = () =>
  fixtures.environmentNode({
    deployments: {
      __typename: 'DeploymentConnection',
      edges: [
        {
          __typename: 'DeploymentEdge',
          node: fixtures.deploymentNode({
            uid: LIVE_DEPLOYMENT_UID,
            deploymentNumber: 3,
            commitMessage: 'live build',
            gitBranch: 'main',
            commitHash: 'ccc3333',
            isRollbackEligible: true,
          }),
        },
        {
          __typename: 'DeploymentEdge',
          node: fixtures.deploymentNode({
            uid: PREVIOUS_DEPLOYMENT_UID,
            deploymentNumber: 2,
            commitMessage: 'previous good build',
            gitBranch: 'main',
            commitHash: 'bbb2222',
            isRollbackEligible: true,
          }),
        },
        {
          __typename: 'DeploymentEdge',
          node: fixtures.deploymentNode({
            uid: 'deployment-uid-broken',
            deploymentNumber: 1,
            commitMessage: 'failed build',
            gitBranch: 'main',
            commitHash: 'aaa1111',
            status: 'FAILED',
            isRollbackEligible: false,
          }),
        },
      ],
    },
  });

describe('launch:rollback', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession();
    cma.withOrganizations([fixtures.ORG]);
    session.api
      .on('Projects', fixtures.projectsResponse())
      .on('Environments', fixtures.environmentsResponse([environmentWithHistory()]))
      .on('LatestLiveDeployment', fixtures.latestLiveDeploymentResponse(LIVE_DEPLOYMENT_UID))
      .on('RollbackDeployment', fixtures.rollbackDeploymentResponse());
  });

  afterEach(async () => {
    await session.stop();
  });

  const baseFlags = () => [
    ...session.baseArgs,
    '--org',
    fixtures.ORG.uid,
    '--project',
    fixtures.PROJECT_UID,
    '--environment',
    fixtures.ENVIRONMENT_NAME,
  ];

  it('rolls back to the deployment named by --deployment', async () => {
    prompts.script([{ name: 'confirm', answer: true }]);

    const result = await runCommand(Rollback, [
      ...baseFlags(),
      '--deployment',
      PREVIOUS_DEPLOYMENT_UID,
      '--reason',
      'reverting a bad release',
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();
    session.api.assertNoUnhandledOperations();

    expect(session.api.operationSequence()).toEqual([
      'Projects',
      'Environments',
      'LatestLiveDeployment',
      'RollbackDeployment',
    ]);

    expect(session.api.variablesOf('Environments')).toEqual({ skipRollbackData: false });

    expect(session.api.variablesOf('RollbackDeployment')).toEqual({
      input: {
        deployment: PREVIOUS_DEPLOYMENT_UID,
        environment: fixtures.ENVIRONMENT_UID,
        reason: 'reverting a bad release',
      },
    });

    expect(result.output).toContain('Instant rollback to a previous deployment is successful.');
  });

  it('offers only rollback-eligible deployments that are not already live', async () => {
    prompts.script([
      {
        name: 'Deployment',
        answerFrom: (question) => {
          expect(question.choices).toHaveLength(1);
          expect(question.choices?.[0].name).toContain('#2');
          expect(question.choices?.[0].value).toBe(PREVIOUS_DEPLOYMENT_UID);
          return PREVIOUS_DEPLOYMENT_UID;
        },
      },
      { name: 'reason', answer: '' },
      { name: 'confirm', answer: true },
    ]);

    const result = await runCommand(Rollback, baseFlags());

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();

    expect(session.api.variablesOf('RollbackDeployment')).toEqual({
      input: { deployment: PREVIOUS_DEPLOYMENT_UID, environment: fixtures.ENVIRONMENT_UID },
    });
  });

  it('sends no mutation when the confirmation is declined', async () => {
    prompts.script([
      { name: 'Deployment', answer: PREVIOUS_DEPLOYMENT_UID },
      { name: 'reason', answer: '' },
      { name: 'confirm', answer: false },
    ]);

    const result = await runCommand(Rollback, baseFlags());

    expect(result.exitCode).toBe(0);
    expect(session.api.calls('RollbackDeployment')).toHaveLength(0);
    expect(result.output).toContain('Rollback aborted.');
  });

  it('refuses a --deployment that is not rollback-eligible', async () => {
    prompts.script([]);

    const result = await runCommand(Rollback, [...baseFlags(), '--deployment', 'deployment-uid-broken']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('not rollback-eligible');
    expect(session.api.calls('RollbackDeployment')).toHaveLength(0);
  });

  it('exits non-zero when the rollback mutation fails', async () => {
    session.api.on('RollbackDeployment', {
      errors: [{ message: 'Rollback rejected', extensions: { exception: { name: 'ROLLBACK_FAILED' } } }],
    });

    prompts.script([
      { name: 'reason', answer: '' },
      { name: 'confirm', answer: true },
    ]);

    const result = await runCommand(Rollback, [...baseFlags(), '--deployment', PREVIOUS_DEPLOYMENT_UID]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Rollback failed. Please try again.');
  });
});
