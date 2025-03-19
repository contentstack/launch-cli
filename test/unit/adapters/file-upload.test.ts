//@ts-nocheck
import { expect } from 'chai';
import { stub, createSandbox, sinon } from 'sinon';
import { cliux } from '@contentstack/cli-utilities';
import fs from 'fs';
import { FileUpload, BaseClass } from '../../../src/adapters';
import { BaseCommand } from '../../../src/base-command';
import { isNull } from 'util';
import { log } from 'console';
import { FileUploadMethod } from '../../../src/types/launch';

describe('File Upload', () => {
  let inquireStub, exitStub, prepareApiClientsStub, prepareConfigStub, getConfigStub;
  let adapterConstructorInputs;

  beforeEach(() => {
    inquireStub = stub(cliux, 'inquire');
    exitStub = stub(BaseCommand.prototype, 'exit');
    prepareConfigStub = stub(BaseCommand.prototype, 'prepareConfig').resolves();
    prepareApiClientsStub = stub(BaseCommand.prototype, 'prepareApiClients').resolves();
    getConfigStub = stub(BaseCommand.prototype, 'getConfig').resolves();

    adapterConstructorInputs = {
      config: getConfigStub,
      apolloClient: prepareApiClientsStub,
      analyticsInfo: 'this.context.analyticsInfo',
    };
  });

  afterEach(() => {
    inquireStub.restore();
    exitStub.restore();
    prepareConfigStub.restore();
    getConfigStub.restore();
    prepareApiClientsStub.restore();
  });

  describe('Run', () => {
    let getEnvironmentStub,
      initApolloClientStub,
      createSignedUploadUrlStub,
      archiveStub,
      uploadFileStub,
      createNewDeploymentStub,
      prepareAndUploadNewProjectFile,
      createNewProjectStub,
      prepareLaunchConfigStub,
      showLogsStub,
      showDeploymentUrlStub,
      showSuggestionStub;
    const signedUploadUrlData = { uploadUrl: 'http://example.com/upload', uploadUid: '123456789' };
    const zipName = 'test.zip';
    const zipPath = '/path/to/zip';
    const defaultEnvironment = { uid: 'testEnvUid', name: 'Default', frameworkPreset: 'OTHER' };
    const environmentMatchedByEnvironmentFlagInput = {
      uid: 'environmentFlagInput',
      name: 'environmentFlagInput',
      frameworkPreset: 'OTHER',
    };

    beforeEach(() => {
      getEnvironmentStub = stub(BaseClass.prototype, 'getEnvironment');
      initApolloClientStub = stub(BaseClass.prototype, 'initApolloClient').resolves();
      createSignedUploadUrlStub = stub(FileUpload.prototype, 'createSignedUploadUrl').resolves(signedUploadUrlData);
      archiveStub = stub(FileUpload.prototype, 'archive').resolves({ zipName, zipPath });
      uploadFileStub = stub(FileUpload.prototype, 'uploadFile').resolves();
      createNewDeploymentStub = stub(FileUpload.prototype, 'createNewDeployment').resolves();
      prepareAndUploadNewProjectFile = stub(FileUpload.prototype, 'prepareAndUploadNewProjectFile').resolves();
      createNewProjectStub = stub(FileUpload.prototype, 'createNewProject').resolves();
      prepareLaunchConfigStub = stub(BaseClass.prototype, 'prepareLaunchConfig').resolves();
      showLogsStub = stub(BaseClass.prototype, 'showLogs').resolves();
      showDeploymentUrlStub = stub(BaseClass.prototype, 'showDeploymentUrl').resolves();
      showSuggestionStub = stub(BaseClass.prototype, 'showSuggestion').resolves();
    });

    afterEach(() => {
      getEnvironmentStub.restore();
      initApolloClientStub.restore();
      createSignedUploadUrlStub.restore();
      archiveStub.restore();
      uploadFileStub.restore();
      createNewDeploymentStub.restore();
      prepareAndUploadNewProjectFile.restore();
      createNewProjectStub.restore();
      prepareLaunchConfigStub.restore();
      showLogsStub.restore();
      showDeploymentUrlStub.restore();
      showSuggestionStub.restore();
    });

    describe('Redeploy existing project', () => {
      let sandbox;
      let processExitStub;

      beforeEach(() => {
        sandbox = createSandbox();
        
        processExitStub = sandbox.stub(process, 'exit').callsFake((code) => {
          throw new Error(code);
        });
      
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should run file upload flow successfully for existing project where flag passed is redeploy-latest', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);
        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            'redeploy-latest': true,
          },
        };
        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.true;
        expect(archiveStub.calledOnce).to.be.true;
        expect(uploadFileStub.calledOnce).to.be.true;
        expect(uploadFileStub.args[0]).to.deep.equal([zipName, zipPath, signedUploadUrlData]);
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([
          true,
          defaultEnvironment.uid,
          signedUploadUrlData.uploadUid,
        ]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should run file upload flow successfully for existing project where environment and redeploy-latest flags are passed.', async () => {
        getEnvironmentStub.resolves(environmentMatchedByEnvironmentFlagInput);
        
        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            'redeploy-latest': true,
            environment: 'environmentFlagInput',
          },
        };
        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.true;
        expect(archiveStub.calledOnce).to.be.true;
        expect(uploadFileStub.calledOnce).to.be.true;
        expect(uploadFileStub.args[0]).to.deep.equal([zipName, zipPath, signedUploadUrlData]);
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([
          true,
          environmentMatchedByEnvironmentFlagInput.uid,
          signedUploadUrlData.uploadUid,
        ]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should run file upload flow successfully for existing project where flag passed is redeploy-last-upload', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            'redeploy-last-upload': true,
          },
        };
        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([true, defaultEnvironment.uid, undefined]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should run file upload flow successfully for existing project where environment and redeploy-last-upload flags are passed', async () => {
        getEnvironmentStub.resolves(environmentMatchedByEnvironmentFlagInput);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            'redeploy-last-upload': true,
            environment: 'environmentFlagInput'
          },
        };
        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([true, environmentMatchedByEnvironmentFlagInput.uid, undefined]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should exit with an error message when both --redeploy-last-upload and --redeploy-latest flags are passed', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            'redeploy-last-upload': true,
            'redeploy-latest': true,
          },
        };
        let exitStatusCode;

        try {
          await new FileUpload(adapterConstructorOptions).run();
        } catch (err) {
          exitStatusCode = err.message;
        }

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(processExitStub.calledOnceWithExactly(1)).to.be.true;
        expect(exitStatusCode).to.equal('1');
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.false;
        expect(prepareLaunchConfigStub.calledOnce).to.be.false;
        expect(showLogsStub.calledOnce).to.be.false;
        expect(showDeploymentUrlStub.calledOnce).to.be.false;
        expect(showSuggestionStub.calledOnce).to.be.false;
      });

      it('should exit with an error message when both --redeploy-last-upload and --redeploy-latest flags are passed alongwith environment flag', async () => {
        getEnvironmentStub.resolves(environmentMatchedByEnvironmentFlagInput);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            'redeploy-last-upload': true,
            'redeploy-latest': true,
            environment: 'environmentFlagInput'
          },
        };
        let exitStatusCode;

        try {
          await new FileUpload(adapterConstructorOptions).run();
        } catch (err) {
          exitStatusCode = err.message;
        }

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(processExitStub.calledOnceWithExactly(1)).to.be.true;
        expect(exitStatusCode).to.equal('1');
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.false;
        expect(prepareLaunchConfigStub.calledOnce).to.be.false;
        expect(showLogsStub.calledOnce).to.be.false;
        expect(showDeploymentUrlStub.calledOnce).to.be.false;
        expect(showSuggestionStub.calledOnce).to.be.false;
      });

      it('should show prompt and successfully redeploy with "new file" if the option to redeploy with new file is selected, when --redeploy-latest and --redeploy-last-upload flags are not passed', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);
        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
          },
        };
        inquireStub
          .withArgs({
            type: 'confirm',
            name: 'deployLatestCommit',
            message: 'Do you want to redeploy this existing Launch project?',
          })
          .resolves(true);
        inquireStub.resolves(FileUploadMethod.NewFile);

        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.true;
        expect(archiveStub.calledOnce).to.be.true;
        expect(uploadFileStub.calledOnce).to.be.true;
        expect(uploadFileStub.args[0]).to.deep.equal([zipName, zipPath, signedUploadUrlData]);
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([true, defaultEnvironment.uid, signedUploadUrlData.uploadUid]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should show prompt and successfully redeploy with "new file" if the option to redeploy with new file is selected, when --redeploy-latest and --redeploy-last-upload flags are not passed and environment flag passed', async () => {
        getEnvironmentStub.resolves(environmentMatchedByEnvironmentFlagInput);
        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            environment: 'environmentFlagInput',
          },
        };
        inquireStub
          .withArgs({
            type: 'confirm',
            name: 'deployLatestCommit',
            message: 'Do you want to redeploy this existing Launch project?',
          })
          .resolves(true);
        inquireStub.resolves(FileUploadMethod.NewFile);

        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.true;
        expect(archiveStub.calledOnce).to.be.true;
        expect(uploadFileStub.calledOnce).to.be.true;
        expect(uploadFileStub.args[0]).to.deep.equal([zipName, zipPath, signedUploadUrlData]);
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([true, environmentMatchedByEnvironmentFlagInput.uid, signedUploadUrlData.uploadUid]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should show prompt and successfully redeploy with "last file upload" if the option to redeploy with last file upload is selected, when --redeploy-latest and --redeploy-last-upload flags are not passed', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
          },
        };
        inquireStub
          .withArgs({
            type: 'confirm',
            name: 'deployLatestCommit',
            message: 'Do you want to redeploy this existing Launch project?',
          })
          .resolves(true);
        inquireStub.resolves(FileUploadMethod.LastFileUpload);

        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([true, defaultEnvironment.uid, undefined]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should show prompt and successfully redeploy with "last file upload" if the option to redeploy with last file upload is selected, when --redeploy-latest and --redeploy-last-upload flags are not passed and environment flag passed', async () => {
        getEnvironmentStub.resolves(environmentMatchedByEnvironmentFlagInput);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
          },
        };
        inquireStub
          .withArgs({
            type: 'confirm',
            name: 'deployLatestCommit',
            message: 'Do you want to redeploy this existing Launch project?',
          })
          .resolves(true);
        inquireStub.resolves(FileUploadMethod.LastFileUpload);

        await new FileUpload(adapterConstructorOptions).run();

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.args[0]).to.deep.equal([true, environmentMatchedByEnvironmentFlagInput.uid, undefined]);
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should exit if "No" is selected for prompt to redeploy, when --redeploy-latest and --redeploy-last-upload flags are not passed and environment flag not passed', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);

        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
          },
        };
        inquireStub
          .withArgs({
            type: 'confirm',
            name: 'deployLatestCommit',
            message: 'Do you want to redeploy this existing Launch project?',
          })
          .resolves(false);
        let exitStatusCode;

        try {
          await new FileUpload(adapterConstructorOptions).run();
        } catch (err) {
          exitStatusCode = err.message;
        }

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(processExitStub.calledOnceWithExactly(1)).to.be.true;
        expect(exitStatusCode).to.equal('1');
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.false;
        expect(prepareLaunchConfigStub.calledOnce).to.be.false;
        expect(showLogsStub.calledOnce).to.be.false;
        expect(showDeploymentUrlStub.calledOnce).to.be.false;
        expect(showSuggestionStub.calledOnce).to.be.false;
      });

      it('should exit if "No" is selected for prompt to redeploy, when --redeploy-latest and --redeploy-last-upload flags are not passed and environment flag is passed', async () => {
        getEnvironmentStub.resolves(defaultEnvironment);
        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            currentConfig: { uid: '123244', organizationUid: 'bltxxxxxxxx' },
            environment: 'environmentFlagInput',
          },
        };
        inquireStub
          .withArgs({
            type: 'confirm',
            name: 'deployLatestCommit',
            message: 'Do you want to redeploy this existing Launch project?',
          })
          .resolves(false);
        let exitStatusCode;

        try {
          await new FileUpload(adapterConstructorOptions).run();
        } catch (err) {
          exitStatusCode = err.message;
        }

        expect(getEnvironmentStub.calledOnce).to.be.true;
        expect(processExitStub.calledOnceWithExactly(1)).to.be.true;
        expect(exitStatusCode).to.equal('1');
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createSignedUploadUrlStub.calledOnce).to.be.false;
        expect(archiveStub.calledOnce).to.be.false;
        expect(uploadFileStub.calledOnce).to.be.false;
        expect(createNewDeploymentStub.calledOnce).to.be.false;
        expect(prepareLaunchConfigStub.calledOnce).to.be.false;
        expect(showLogsStub.calledOnce).to.be.false;
        expect(showDeploymentUrlStub.calledOnce).to.be.false;
        expect(showSuggestionStub.calledOnce).to.be.false;
      });
    });

    describe('Deploy new project', () => {
      let adapterConstructorOptions = {
        config: {
          isExistingProject: false,
        },
      };
      it('should run file upload flow for new project', async () => {
        await new FileUpload(adapterConstructorOptions).run();

        expect(prepareAndUploadNewProjectFile.calledOnce).to.be.true;
        expect(createNewProjectStub.calledOnce).to.be.true;
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });
    });
  });

  describe('createNewProject', () => {
    let sandbox;
    let adapterConstructorOptions = {
      config: {
        framework: 'React',
        projectName: 'New Project',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        environmentName: 'Production',
        currentConfig: null,
      },
    };
    beforeEach(() => {
      sandbox = createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should log a success message and update the config when the mutation succeeds', async () => {
      const apolloClientMutateStub = sandbox.stub().resolves({
        data: {
          project: {
            environments: [
              {
                deployments: {
                  edges: [{ node: 'deployment1' }, { node: 'deployment2' }],
                },
              },
            ],
          },
        },
      });
      const signedUploadUrlData = {
        uploadUid: '123456789',
      };
      const apolloClient = {
        mutate: apolloClientMutateStub,
      };

      const fileUploadInstance = new FileUpload(adapterConstructorOptions);
      fileUploadInstance.apolloClient = apolloClient;
      fileUploadInstance.signedUploadUrlData = signedUploadUrlData;

      await fileUploadInstance.createNewProject();

      expect(apolloClientMutateStub.calledOnce).to.be.true;
    });
  });

  describe('prepareAndUploadNewProjectFile', () => {
    let createSignedUploadUrlStub,
      archiveStub,
      uploadFileStub,
      selectOrgStub,
      detectFrameworkStub,
      handleEnvImportFlowStub;
    let adapterConstructorOptions = {
      config: {
        flags: {
          name: 'Test project',
          framework: 'Gatsby',
          environment: 'dev',
          'build-command': 'npm run build',
          'output-directory': './',
        },
        listOfFrameWorks: [
          { name: 'Gatsby', value: 'GATSBY' },
          { name: 'NextJs', value: 'NEXTJS' },
          { name: 'Other', value: 'OTHER' },
        ],
        outputDirectories: '',
        supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX'],
      },
    };
    let archiveMockData = { zipName: 'abc.zip', zipPath: 'path/to/zip', projectName: 'test' };
    beforeEach(function () {
      createSignedUploadUrlStub = stub(FileUpload.prototype, 'createSignedUploadUrl').resolves({
        uploadUid: '123456789',
      });
      archiveStub = stub(FileUpload.prototype, 'archive').resolves(archiveMockData);
      uploadFileStub = stub(FileUpload.prototype, 'uploadFile');
      uploadFileStub.withArgs(archiveMockData.zipName, archiveMockData.zipPath);
      selectOrgStub = stub(BaseClass.prototype, 'selectOrg').resolves();
      detectFrameworkStub = stub(BaseClass.prototype, 'detectFramework').resolves();
      handleEnvImportFlowStub = stub(BaseClass.prototype, 'handleEnvImportFlow').resolves();
    });
    afterEach(function () {
      createSignedUploadUrlStub.restore();
      archiveStub.restore();
      uploadFileStub.restore();
      selectOrgStub.restore();
      detectFrameworkStub.restore();
      handleEnvImportFlowStub.restore();
    });

    it('prepare for new project', async function () {
      await new FileUpload(adapterConstructorOptions).prepareAndUploadNewProjectFile();
    });
  });

  describe('fileValidation', () => {
    let sandbox;
    let adapterConstructorOptions = {
      config: {
        projectBasePath: '/path/to/project',
      },
    };
    beforeEach(() => {
      sandbox = createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should log a message and exit when package.json file does not exist', () => {
      const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
      const exitStub = sandbox.stub(process, 'exit');

      const fileUploadInstance = new FileUpload(adapterConstructorOptions);

      fileUploadInstance.fileValidation();

      expect(existsSyncStub.calledOnceWithExactly('/path/to/project/package.json')).to.be.true;
      expect(exitStub.calledOnceWithExactly(1)).to.be.true;
    });

    it('should not log a message or exit when package.json file exists', () => {
      const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);
      const exitStub = sandbox.stub(process, 'exit');

      const fileUploadInstance = new FileUpload(adapterConstructorOptions);

      fileUploadInstance.fileValidation();

      expect(existsSyncStub.calledOnceWithExactly('/path/to/project/package.json')).to.be.true;
      expect(exitStub.called).to.be.false;
    });
  });

  describe('createSignedUploadUrl', () => {
    let sandbox, logStub, exitStub;

    beforeEach(() => {
      sandbox = createSandbox();
      logStub = sandbox.stub(console, 'log');
      exitStub = sandbox.stub(process, 'exit');
    });

    afterEach(() => {
      sandbox.restore();
      logStub.restore();
      exitStub.restore();
    });

    it('should set the signed upload URL and upload UID in the config', async () => {
      const expectedSignedUploadUrl = { uploadUrl: 'http://example.com/upload', uploadUid: '123456789' };
      const apolloClientMock = {
        mutate: sandbox.stub().resolves({ data: { signedUploadUrl: expectedSignedUploadUrl } }),
      };

      const fileUploadInstance = new FileUpload(adapterConstructorInputs);
      fileUploadInstance.apolloClient = apolloClientMock;
      fileUploadInstance.signedUploadUrlData = expectedSignedUploadUrl.uploadUrl;
      fileUploadInstance.config.uploadUid = expectedSignedUploadUrl.uploadUid;

      const signedUploadUrlData = await fileUploadInstance.createSignedUploadUrl();

      expect(fileUploadInstance.config.uploadUid).to.equal(expectedSignedUploadUrl.uploadUid);
      expect(signedUploadUrlData).to.equal(expectedSignedUploadUrl);
    });

    it('should log an error message and exit when the mutation fails', async () => {
      const expectedSignedUploadUrl = { uploadUrl: null, uploadUid: null };
      const apolloClientMock = {
        mutate: sandbox.stub().rejects(new Error('Mutation failed')),
      };
      const fileUploadInstance = new FileUpload(adapterConstructorInputs);

      fileUploadInstance.apolloClient = apolloClientMock;
      fileUploadInstance.log = logStub;
      fileUploadInstance.exit = exitStub;
      fileUploadInstance.signedUploadUrlData = expectedSignedUploadUrl.uploadUrl;
      fileUploadInstance.config.uploadUid = expectedSignedUploadUrl.uploadUid;

      await fileUploadInstance.createSignedUploadUrl();

      expect(logStub.calledWith('Something went wrong. Please try again.', 'warn')).to.be.true;
      expect(logStub.calledWith('Mutation failed', 'error')).to.be.true;
      expect(exitStub.calledOnceWithExactly(1)).to.be.true;
    });
  });
});
