import Launch from '../../../src/commands/launch/index';
import { cma, fixtures, prompts, runCommand, Session, startSession } from '../harness';

const PACKAGE_JSON = JSON.stringify({ name: 'integration-project', version: '1.0.0' }, null, 2);

const startGithubSession = (overrides: Record<string, any> = {}) =>
  startSession({
    files: { 'package.json': PACKAGE_JSON },
    gitRepo: { remoteUrl: `${fixtures.REPOSITORY.url}.git`, defaultBranch: 'main' },
    ...overrides,
  });

const stubHappyPathApi = (session: Session) => {
  session.api
    .on('UserConnections', fixtures.userConnectionsResponse())
    .on('GitRepositories', fixtures.repositoriesResponse())
    .on('GitBranches', fixtures.branchesResponse(['main', 'develop']))
    .on('Framework', fixtures.frameworkResponse('GATSBY'))
    .on('importProject', fixtures.importProjectResponse())
    .on('Environments', fixtures.environmentsResponse())
    .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
    .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Build started', 'Build finished']));
};

describe('launch (GitHub provider)', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startGithubSession();
    cma.withOrganizations([fixtures.ORG, fixtures.OTHER_ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  it('creates and deploys a new project, driven entirely by prompts', async () => {
    stubHappyPathApi(session);

    prompts.script([
      { name: 'projectType', answer: 'GitHub' },
      { name: 'Organization', answer: fixtures.ORG.name },
      { name: 'branch', answer: 'main' },
      { name: 'projectName', answer: 'integration-project' },
      { name: 'environmentName', answer: 'Default' },
      { name: 'frameworkPreset', answer: 'GATSBY' },
      { name: 'buildCommand', answer: 'npm run build' },
      { name: 'outputDirectory', answer: './public' },
      { name: 'responseMode', answer: 'buffered' },
      { name: 'contentstackAuth', answer: true },
      { name: 'variablePreparationType', answer: ['Skip adding environment variables'] },
    ]);

    const result = await runCommand(Launch, session.baseArgs);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();
    session.api.assertNoUnhandledOperations();

    expect(session.api.operationSequence()).toEqual([
      'UserConnections',
      'GitRepositories',
      'GitBranches',
      'Framework',
      'importProject',
      'getDeploymentsById',
      'GetDeploymentLogsV2',
    ]);

    expect(session.api.variablesOf('importProject')).toEqual({
      skipGitData: false,
      project: {
        name: 'integration-project',
        cmsStackApiKey: '',
        repository: {
          username: 'launch-org',
          repositoryUrl: fixtures.REPOSITORY.url,
          repositoryName: fixtures.REPOSITORY.fullName,
          gitProviderMetadata: { gitProvider: 'GitHub' },
        },
        environment: {
          name: 'Default',
          gitBranch: 'main',
          frameworkPreset: 'GATSBY',
          outputDirectory: './public',
          buildCommand: 'npm run build',
          environmentVariables: [],
          isStreamingEnabled: false,
          isContentstackAuthenticationEnabled: true,
        },
      },
    });

    expect(session.api.variablesOf('GitBranches')).toEqual({
      page: 1,
      first: 100,
      query: { provider: 'GitHub', repoName: fixtures.REPOSITORY.fullName },
    });

    expect(session.api.variablesOf('Framework')).toEqual({
      query: { provider: 'GitHub', repoName: fixtures.REPOSITORY.fullName, branchName: 'main' },
    });

    const launchConfigFile = session.readLaunchConfigFile();
    expect(Object.keys(launchConfigFile)).toEqual(['main']);
    expect(launchConfigFile.main).toMatchObject({
      uid: fixtures.PROJECT_UID,
      name: fixtures.PROJECT_NAME,
      organizationUid: fixtures.ORG.uid,
      projectType: 'GITPROVIDER',
    });
    expect(launchConfigFile.main.environments).toHaveLength(1);
    expect(launchConfigFile.main.deployments[0]).toMatchObject({ uid: fixtures.DEPLOYMENT_UID });

    expect(result.output).toContain('GitHub connection identified!');
    expect(result.output).toContain('User access verified');
    expect(result.output).toContain('New project created successfully');
    expect(result.output).toContain('Build finished');
    expect(result.output).toContain(`https://${fixtures.DEPLOYMENT_URL}`);
  });

  it('skips every prompt the equivalent flag already answers', async () => {
    stubHappyPathApi(session);

    prompts.script([]);

    const result = await runCommand(Launch, [
      ...session.baseArgs,
      '--type',
      'GitHub',
      '--org',
      fixtures.ORG.uid,
      '--branch',
      'main',
      '--name',
      'flagged-project',
      '--environment',
      'Default',
      '--framework',
      'Gatsby',
      '--build-command',
      'npm run build:ci',
      '--out-dir',
      './dist',
      '--response-mode',
      'streaming',
      '--disable-cs-auth',
      '--variable-type',
      'Skip adding environment variables',
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(prompts.promptSequence()).toEqual([]);

    expect(session.api.operationSequence()).toEqual([
      'UserConnections',
      'GitRepositories',
      'GitBranches',
      'importProject',
      'Environments',
      'getDeploymentsById',
      'GetDeploymentLogsV2',
    ]);

    expect(session.api.variablesOf('importProject').project).toMatchObject({
      name: 'flagged-project',
      environment: {
        name: 'Default',
        gitBranch: 'main',
        frameworkPreset: 'GATSBY',
        outputDirectory: './dist',
        buildCommand: 'npm run build:ci',
        isStreamingEnabled: true,
        isContentstackAuthenticationEnabled: false,
      },
    });
  });

  it('sends manually entered environment variables with the project', async () => {
    stubHappyPathApi(session);

    prompts.script([
      { name: 'projectType', answer: 'GitHub' },
      { name: 'Organization', answer: fixtures.ORG.name },
      { name: 'branch', answer: 'main' },
      { name: 'projectName', answer: 'integration-project' },
      { name: 'environmentName', answer: 'Default' },
      { name: 'frameworkPreset', answer: 'GATSBY' },
      { name: 'buildCommand', answer: 'npm run build' },
      { name: 'outputDirectory', answer: './public' },
      { name: 'responseMode', answer: 'buffered' },
      { name: 'contentstackAuth', answer: true },
      { name: 'variablePreparationType', answer: ['Manually add custom variables to the list'] },
      { name: 'variable', answer: 'APP_ENV:prod, TEST_ENV:testVal' },
      { name: 'canImportFromStack', answer: false },
    ]);

    const result = await runCommand(Launch, session.baseArgs);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    prompts.assertScriptFullyConsumed();

    expect(session.api.variablesOf('importProject').project.environment.environmentVariables).toEqual([
      { key: 'APP_ENV', value: 'prod' },
      { key: 'TEST_ENV', value: 'testVal' },
    ]);
  });

  it('stops before creating a project when the repo has no GitHub connection', async () => {
    session.api.on('UserConnections', fixtures.userConnectionsResponse([]));

    prompts.script([
      { name: 'projectType', answer: 'GitHub' },
      { name: 'Organization', answer: fixtures.ORG.name },
      { name: 'branch', answer: 'main' },
      { name: 'projectName', answer: 'integration-project' },
    ]);

    const result = await runCommand(Launch, session.baseArgs);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('GitHub connection not found!');
    expect(session.api.calls('importProject')).toHaveLength(0);
    expect(session.hasLaunchConfigFile()).toBe(false);
  });

  it('exits non-zero and writes no config when the deployment fails', async () => {
    stubHappyPathApi(session);
    session.api
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('FAILED'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Build failed']));

    prompts.script([]);

    const result = await runCommand(Launch, [
      ...session.baseArgs,
      '--type',
      'GitHub',
      '--org',
      fixtures.ORG.uid,
      '--branch',
      'main',
      '--name',
      'integration-project',
      '--environment',
      'Default',
      '--framework',
      'Gatsby',
      '--build-command',
      'npm run build',
      '--out-dir',
      './public',
      '--response-mode',
      'buffered',
      '--disable-cs-auth',
      '--variable-type',
      'Skip adding environment variables',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Build failed');
  });

  it('redeploys the latest commit for an existing GitHub project', async () => {
    await session.stop();
    session = await startGithubSession({
      launchConfigFile: fixtures.existingProjectConfigFile(),
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('CreateDeployment', fixtures.createDeploymentResponse())
      .on('Environments', fixtures.environmentsResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Redeploy finished']));

    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-latest']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();

    expect(prompts.promptSequence()).toEqual([]);
    expect(session.api.calls('importProject')).toHaveLength(0);
    expect(session.api.variablesOf('CreateDeployment')).toEqual({
      skipGitData: false,
      deployment: {
        environment: fixtures.ENVIRONMENT_UID,
      },
    });
    expect(result.output).toContain('Existing launch project identified');
  });

  it('rejects --redeploy-last-upload for a GitHub project', async () => {
    await session.stop();
    session = await startGithubSession({
      launchConfigFile: fixtures.existingProjectConfigFile(),
    });
    cma.withOrganizations([fixtures.ORG]);
    session.api.on('Environments', fixtures.environmentsResponse());
    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-last-upload']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('redeploy-last-upload flag is not supported');
    expect(session.api.calls('CreateDeployment')).toHaveLength(0);
  });
});
