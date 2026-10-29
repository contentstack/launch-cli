import { existsSync } from 'fs';
import { resolve } from 'path';

import Launch from '../../../src/commands/launch/index';
import { cma, fixtures, prompts, runCommand, Session, startSession } from '../harness';

const PROJECT_FILES = {
  'package.json': JSON.stringify({ name: 'integration-project', version: '1.0.0' }, null, 2),
  'public/index.html': '<!doctype html><title>integration</title>',
};

describe('launch (FileUpload provider)', () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession({ files: PROJECT_FILES });
    cma.withOrganizations([fixtures.ORG]);
  });

  afterEach(async () => {
    await session.stop();
  });

  const stubHappyPathApi = () => {
    session.api
      .on('CreateSignedUploadUrl', fixtures.signedUploadUrlResponse(`${session.api.baseUrl}/upload/bundle.zip`))
      .on('FileFramework', fixtures.fileFrameworkResponse('GATSBY'))
      .on('importProject', fixtures.importFileUploadProjectResponse())
      .on('Environments', fixtures.environmentsResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Upload deployed']));
  };

  it('zips the project, uploads it, and creates a file-upload project', async () => {
    stubHappyPathApi();

    prompts.script([
      { name: 'projectType', answer: 'FileUpload' },
      { name: 'Organization', answer: fixtures.ORG.name },
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
      'CreateSignedUploadUrl',
      'FileFramework',
      'importProject',
      'getDeploymentsById',
      'GetDeploymentLogsV2',
    ]);

    const uploads = session.api.uploadedFiles();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].method).toBe('PUT');
    expect(uploads[0].path).toBe('/upload/bundle.zip');
    expect(uploads[0].byteLength).toBeGreaterThan(0);

    expect(session.api.variablesOf('FileFramework')).toEqual({
      query: { uploadUid: 'upload-uid-1' },
    });

    expect(session.api.variablesOf('importProject')).toEqual({
      skipGitData: true,
      project: {
        projectType: 'FILEUPLOAD',
        name: 'integration-project',
        fileUpload: { uploadUid: 'upload-uid-1' },
        environment: {
          name: 'Default',
          frameworkPreset: 'GATSBY',
          outputDirectory: './public',
          buildCommand: 'npm run build',
          environmentVariables: [],
          isStreamingEnabled: false,
          isContentstackAuthenticationEnabled: true,
        },
      },
    });

    const launchConfigFile = session.readLaunchConfigFile();
    expect(Object.keys(launchConfigFile)).toEqual(['project']);
    expect(launchConfigFile.project).toMatchObject({
      uid: fixtures.PROJECT_UID,
      projectType: 'FILEUPLOAD',
    });
  });

  it('redeploys the last upload without re-uploading the project', async () => {
    await session.stop();
    session = await startSession({
      files: PROJECT_FILES,
      launchConfigFile: fixtures.existingProjectConfigFile({ projectType: 'FILEUPLOAD' }),
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('Environments', fixtures.environmentsResponse())
      .on('CreateDeployment', fixtures.createDeploymentResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Redeploy finished']));

    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-last-upload']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    session.api.assertNoUnhandledOperations();

    expect(prompts.promptSequence()).toEqual([]);
    expect(session.api.calls('CreateSignedUploadUrl')).toHaveLength(0);
    expect(session.api.uploadedFiles()).toHaveLength(0);
    expect(session.api.variablesOf('CreateDeployment')).toEqual({
      skipGitData: true,
      deployment: { environment: fixtures.ENVIRONMENT_UID },
    });
  });

  it('uploads a fresh archive when redeploying the latest files', async () => {
    await session.stop();
    session = await startSession({
      files: PROJECT_FILES,
      launchConfigFile: fixtures.existingProjectConfigFile({ projectType: 'FILEUPLOAD' }),
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('Environments', fixtures.environmentsResponse())
      .on('CreateSignedUploadUrl', fixtures.signedUploadUrlResponse(`${session.api.baseUrl}/upload/bundle.zip`))
      .on('CreateDeployment', fixtures.createDeploymentResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Redeploy finished']));

    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-latest']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(prompts.promptSequence()).toEqual([]);
    expect(session.api.uploadedFiles()).toHaveLength(1);
    expect(session.api.variablesOf('CreateDeployment')).toEqual({
      skipGitData: true,
      deployment: { environment: fixtures.ENVIRONMENT_UID, uploadUid: 'upload-uid-1' },
    });
  });

  it('reads --config from a subdirectory while zipping the --data-dir root (CL-1570)', async () => {
    await session.stop();
    session = await startSession({
      files: PROJECT_FILES,
      launchConfigFile: fixtures.existingProjectConfigFile({ projectType: 'FILEUPLOAD' }),
      launchConfigFileAt: 'launch-config/.cs-launch.acc.json',
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('Environments', fixtures.environmentsResponse())
      .on('CreateSignedUploadUrl', fixtures.signedUploadUrlResponse(`${session.api.baseUrl}/upload/bundle.zip`))
      .on('CreateDeployment', fixtures.createDeploymentResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Redeploy finished']));

    prompts.script([]);

    const result = await runCommand(Launch, [
      ...session.baseArgs,
      '--config',
      session.launchConfigPath,
      '--redeploy-latest',
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(prompts.promptSequence()).toEqual([]);
    expect(session.api.uploadedFiles()).toHaveLength(1);

    const zipped = session.api.uploadedZipEntries();
    expect(zipped).toContain('package.json');
    expect(zipped).toContain('public/index.html');

    expect(session.api.variablesOf('CreateDeployment')).toEqual({
      skipGitData: true,
      deployment: { environment: fixtures.ENVIRONMENT_UID, uploadUid: 'upload-uid-1' },
    });
    expect(existsSync(resolve(session.projectDir, '.cs-launch.json'))).toBe(false);
    expect(session.readLaunchConfigFile().project.uid).toBe(fixtures.PROJECT_UID);
  });

  it('uploads through a multipart form post when the signed URL carries form fields', async () => {
    await session.stop();
    session = await startSession({
      files: PROJECT_FILES,
      launchConfigFile: fixtures.existingProjectConfigFile({ projectType: 'FILEUPLOAD' }),
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('Environments', fixtures.environmentsResponse())
      .on(
        'CreateSignedUploadUrl',
        fixtures.signedUploadUrlWithFormFieldsResponse(`${session.api.baseUrl}/upload/bundle.zip`),
      )
      .on('CreateDeployment', fixtures.createDeploymentResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2Response(['Redeploy finished']));

    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-latest']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);

    const [upload] = session.api.uploadedFiles();
    expect(upload.method).toBe('POST');
    expect(upload.contentType).toMatch(/^multipart\/form-data/);

    const sent = upload.body.toString('latin1');
    expect(sent).toContain('uploads/bundle.zip');
    expect(sent).toContain('test-policy');
  });

  it('explains the file-size limit when the API rejects the upload (launch.DEPLOYMENT.FILE_UPLOAD_FAILED)', async () => {
    await session.stop();
    session = await startSession({
      files: PROJECT_FILES,
      launchConfigFile: fixtures.existingProjectConfigFile({ projectType: 'FILEUPLOAD' }),
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('Environments', fixtures.environmentsResponse())
      .on('CreateSignedUploadUrl', fixtures.signedUploadUrlResponse(`${session.api.baseUrl}/upload/bundle.zip`))
      .on('CreateDeployment', fixtures.fileSizeRejectedResponse());

    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-latest']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Deployment process failed');
    expect(result.output).toContain('Please use a file over the size of 1KB and under the size of 100MB.');
  });

  it('falls back to the legacy getLogs query when the logs service has no getDeploymentLogsV2', async () => {
    await session.stop();
    session = await startSession({
      files: PROJECT_FILES,
      launchConfigFile: fixtures.existingProjectConfigFile({ projectType: 'FILEUPLOAD' }),
    });
    cma.withOrganizations([fixtures.ORG]);

    session.api
      .on('Environments', fixtures.environmentsResponse())
      .on('CreateDeployment', fixtures.createDeploymentResponse())
      .on('getDeploymentsById', fixtures.deploymentStatusResponse('LIVE'))
      .on('GetDeploymentLogsV2', fixtures.deploymentLogsV2UnsupportedResponse())
      .on('GetLogs', fixtures.deploymentLogsV1Response(['Legacy build finished']));

    prompts.script([]);

    const result = await runCommand(Launch, [...session.baseArgs, '--redeploy-last-upload']);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(session.api.operationSequence()).toContain('GetLogs');
    expect(session.api.variablesOf('GetLogs')).toMatchObject({ deploymentUid: fixtures.DEPLOYMENT_UID });
    expect(result.output).toContain('Legacy build finished');
  });

  it('exits non-zero when the signed upload URL cannot be created', async () => {
    session.api.on('CreateSignedUploadUrl', {
      errors: [{ message: 'Upload quota exceeded' }],
    });

    prompts.script([
      { name: 'projectType', answer: 'FileUpload' },
      { name: 'Organization', answer: fixtures.ORG.name },
    ]);

    const result = await runCommand(Launch, session.baseArgs);

    expect(result.exitCode).toBe(1);
    expect(session.api.calls('importProject')).toHaveLength(0);
    expect(session.hasLaunchConfigFile()).toBe(false);
  });
});
