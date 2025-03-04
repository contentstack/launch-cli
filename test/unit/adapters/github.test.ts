//@ts-nocheck
import { expect } from 'chai';
import { stub, createSandbox } from 'sinon';
import { cliux } from '@contentstack/cli-utilities';
import { githubAdapterMockData } from '../mock/index';
import { GitHub, BaseClass } from '../../../src/adapters';
import { BaseCommand } from '../../../src/base-command';
import fs from 'fs';

describe('GitHub', () => {
  let inquireStub, prepareApiClientsStub, prepareConfigStub, getConfigStub;
  let adapterConstructorInputs;

  beforeEach(() => {
    inquireStub = stub(cliux, 'inquire');
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
    prepareConfigStub.restore();
    getConfigStub.restore();
    prepareApiClientsStub.restore();
  });

  describe('Run', () => {
    let initApolloClientStub,
      createNewDeploymentStub,
      checkGitHubConnectedStub,
      checkGitRemoteAvailableAndValidStub,
      checkUserGitHubAccessStub,
      prepareForNewProjectCreationStub,
      createNewProjectStub,
      prepareLaunchConfigStub,
      showLogsStub,
      showDeploymentUrlStub,
      exitStub,
      showSuggestionStub;

    beforeEach(() => {
      initApolloClientStub = stub(BaseClass.prototype, 'initApolloClient').resolves();
      createNewDeploymentStub = stub(GitHub.prototype, 'createNewDeployment').resolves();
      checkGitHubConnectedStub = stub(GitHub.prototype, 'checkGitHubConnected').resolves(
        githubAdapterMockData.userconnection,
      );
      checkGitRemoteAvailableAndValidStub = stub(GitHub.prototype, 'checkGitRemoteAvailableAndValid').resolves();
      checkUserGitHubAccessStub = stub(GitHub.prototype, 'checkUserGitHubAccess').resolves(true);
      prepareForNewProjectCreationStub = stub(GitHub.prototype, 'prepareForNewProjectCreation').resolves();
      createNewProjectStub = stub(GitHub.prototype, 'createNewProject').resolves();
      prepareLaunchConfigStub = stub(BaseClass.prototype, 'prepareLaunchConfig').resolves();
      showLogsStub = stub(BaseClass.prototype, 'showLogs').resolves();
      showDeploymentUrlStub = stub(BaseClass.prototype, 'showDeploymentUrl').resolves();
      showSuggestionStub = stub(BaseClass.prototype, 'showSuggestion').resolves();
      exitStub = stub(BaseCommand.prototype, 'exit').resolves();
    });

    afterEach(() => {
      initApolloClientStub.restore();
      createNewDeploymentStub.restore();
      checkGitHubConnectedStub.restore();
      checkGitRemoteAvailableAndValidStub.restore();
      checkUserGitHubAccessStub.restore();
      prepareForNewProjectCreationStub.restore();
      createNewProjectStub.restore();
      prepareLaunchConfigStub.restore();
      showLogsStub.restore();
      showDeploymentUrlStub.restore();
      showSuggestionStub.restore();
      exitStub.restore();
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

      it('should successfully run github flow for existing project when flag redeploy-latest is passed ', async () => {
        let adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            'redeploy-latest': true,
          },
        };

        await new GitHub(adapterConstructorOptions).run();

        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should abort github flow for existing project when flag redeploy-last-upload is passed', async () => {
        const adapterConstructorOptions = {
          config: {
            isExistingProject: true,
            'redeploy-last-upload': true,
          },
        };
        let exitStatusCode;

        try {
          await new GitHub(adapterConstructorOptions).run();
        } catch (err) {
          exitStatusCode = err.message;
        }

        expect(processExitStub.calledOnceWithExactly(1)).to.be.true;
        expect(exitStatusCode).to.equal('1');
        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.calledOnce).to.be.false;
        expect(prepareLaunchConfigStub.calledOnce).to.be.false;
        expect(showLogsStub.calledOnce).to.be.false;
        expect(showDeploymentUrlStub.calledOnce).to.be.false;
        expect(showSuggestionStub.calledOnce).to.be.false;
      });

      it('should show prompt and successfully redeploy with "latest commit" if the option to redeploy is selected, when --redeploy-latest flag is not passed', async() => {
        const adapterConstructorOptions = {
          config: {
            isExistingProject: true
          },
        };
        inquireStub.withArgs({
          type: 'confirm',
          name: 'deployLatestCommit',
          message: 'Redeploy latest commit?',
        }).resolves(true);

        await new GitHub(adapterConstructorOptions).run();

        expect(initApolloClientStub.calledOnce).to.be.true;
        expect(createNewDeploymentStub.calledOnce).to.be.true;
        expect(prepareLaunchConfigStub.calledOnce).to.be.true;
        expect(showLogsStub.calledOnce).to.be.true;
        expect(showDeploymentUrlStub.calledOnce).to.be.true;
        expect(showSuggestionStub.calledOnce).to.be.true;
      });

      it('should exit if "No" is selected for prompt to redeploy, when --redeploy-latest flag is not passed', async() => {
        const adapterConstructorOptions = {
          config: {
            isExistingProject: true
          },
        };
        inquireStub.withArgs({
          type: 'confirm',
          name: 'deployLatestCommit',
          message: 'Redeploy latest commit?',
        }).resolves(false);
        let exitStatusCode;

        try {
          await new GitHub(adapterConstructorOptions).run();
        } catch (err) {
          exitStatusCode = err.message;
        }

        expect(processExitStub.calledOnceWithExactly(1)).to.be.true;
        expect(exitStatusCode).to.equal('1');
        expect(initApolloClientStub.calledOnce).to.be.true;
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
      it('should create new project if GitHub is not connected', async () => {
        checkGitHubConnectedStub.resolves(false);

        await new GitHub(adapterConstructorOptions).run();

        expect(checkGitHubConnectedStub.calledOnce).to.be.true;
        expect(checkGitRemoteAvailableAndValidStub.called).to.be.false;
        expect(checkUserGitHubAccessStub.called).to.be.false;
        expect(prepareForNewProjectCreationStub.called).to.be.false;
        expect(createNewProjectStub.calledOnce).to.be.true;
      });

      it('should create new project if git remote is not available', async () => {
        checkGitRemoteAvailableAndValidStub.resolves(false);

        await new GitHub(adapterConstructorOptions).run();

        expect(checkGitHubConnectedStub.calledOnce).to.be.true;
        expect(checkGitRemoteAvailableAndValidStub.calledOnce).to.be.true;
        expect(checkUserGitHubAccessStub.called).to.be.false;
        expect(prepareForNewProjectCreationStub.called).to.be.false;
        expect(createNewProjectStub.calledOnce).to.be.true;
      });
      it('should not proceed if user does not have GitHub access', async () => {
        checkGitHubConnectedStub.resolves(true);
        checkGitRemoteAvailableAndValidStub.resolves(true);
        checkUserGitHubAccessStub.resolves(false);
    
        await new GitHub(adapterConstructorOptions).run();
    
        expect(checkGitHubConnectedStub.calledOnce).to.be.true;
        expect(checkGitRemoteAvailableAndValidStub.calledOnce).to.be.true;
        expect(checkUserGitHubAccessStub.calledOnce).to.be.true;
        expect(prepareForNewProjectCreationStub.called).to.be.false;
        expect(createNewProjectStub.calledOnce).to.be.true;
    });

      it('should proceed to prepare for new project creation if user has GitHub access', async () => {
        checkGitHubConnectedStub.resolves(true);
        checkGitRemoteAvailableAndValidStub.resolves(true);
        checkUserGitHubAccessStub.resolves(true);

        await new GitHub(adapterConstructorOptions).handleNewProject();

        expect(checkGitHubConnectedStub.calledOnce).to.be.true;
        expect(checkGitRemoteAvailableAndValidStub.calledOnce).to.be.true;
        expect(checkUserGitHubAccessStub.calledOnce).to.be.true;
        expect(prepareForNewProjectCreationStub.calledOnce).to.be.true;
        expect(createNewProjectStub.calledOnce).to.be.true;
      });
    });
  });

  describe('createNewProject', () => {
    let sandbox;

    beforeEach(() => {
      sandbox = createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should log "New project created successfully" and update the currentConfig if the mutation succeeds', async () => {
      let adapterConstructorOptions = {
        config: {
          branch: 'main',
          provider: 'GitHub',
          framework: 'React',
          repository: {
            fullName: 'username/repo',
            url: 'https://github.com/username/repo',
          },
          projectName: 'New Project',
          buildCommand: 'npm run build',
          selectedStack: {
            api_key: 'api_key',
          },
          outputDirectory: 'dist',
          environmentName: 'Production',
          currentConfig: null,
        },
      };

      const logStub = sandbox.stub(console, 'log');

      const apolloClientMutateStub = sandbox.stub().resolves({
        data: {
          project: {
            environments: [
              {
                deployments: {
                  edges: [
                    {
                      node: {
                        id: 'deployment1',
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const apolloClient = {
        mutate: apolloClientMutateStub,
      };

      const githubInstance = new GitHub(adapterConstructorOptions);
      githubInstance.apolloClient = apolloClient;

      await githubInstance.createNewProject();

      expect(logStub.calledOnceWithExactly('New project created successfully', 'info')).to.be.true;
    });
  });

  describe('prepareForNewProjectCreation', () => {
    let selectOrgStub, selectBranchStub, detectFrameworkStub, handleEnvImportFlowStub;
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
        repository: { fullName: 'Gatsby Starter' },
        outputDirectories: '',
        supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX'],
      },
    };
    beforeEach(function () {
      selectOrgStub = stub(BaseClass.prototype, 'selectOrg').resolves();
      selectBranchStub = stub(BaseClass.prototype, 'selectBranch').resolves();
      detectFrameworkStub = stub(BaseClass.prototype, 'detectFramework').resolves();
      handleEnvImportFlowStub = stub(BaseClass.prototype, 'handleEnvImportFlow').resolves();
    });
    afterEach(function () {
      selectOrgStub.restore();
      selectBranchStub.restore();
      detectFrameworkStub.restore();
      handleEnvImportFlowStub.restore();
    });

    it('prepare for new project', async function () {
      await new GitHub(adapterConstructorOptions).prepareForNewProjectCreation();
    });
  });

  describe('checkGitHubConnected', () => {
    let sandbox;
    let adapterConstructorOptions = {
      config: {
        provider: 'GitHub',
        userConnection: null,
      },
    };

    beforeEach(() => {
      sandbox = createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should log "GitHub connection identified!" and return the userConnection object if found', async () => {
      const apolloClientQueryStub = sandbox.stub().resolves({
        data: {
          userConnections: [
            {
              provider: 'GitHub',
              userUid: '123',
            },
          ],
        },
      });

      const apolloClient = {
        query: apolloClientQueryStub,
      };
      const githubInstance = new GitHub(adapterConstructorOptions);
      githubInstance.apolloClient = apolloClient;

      const result = await githubInstance.checkGitHubConnected();

      expect(result).to.deep.equal({
        userUid: '123',
        provider: 'GitHub',
      });
    });

    it('should log "GitHub connection not found!" and call connectToAdapterOnUi if no userConnection is found', async () => {
      const apolloClientQueryStub = sandbox.stub().resolves({
        data: {
          userConnections: [
            {
              provider: 'Other',
              userUid: '232',
            },
          ],
        },
      });

      const apolloClient = {
        query: apolloClientQueryStub,
      };
      const githubInstance = new GitHub(adapterConstructorOptions);
      githubInstance.apolloClient = apolloClient;

      const connectToAdapterOnUiStub = sandbox.stub(GitHub.prototype, 'connectToAdapterOnUi').resolves();

      await githubInstance.checkGitHubConnected();

      expect(connectToAdapterOnUiStub.calledOnce).to.be.true;
    });
  });
});
