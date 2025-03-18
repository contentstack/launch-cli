import map from 'lodash/map';
import { resolve } from 'path';
import omit from 'lodash/omit';
import find from 'lodash/find';
import split from 'lodash/split';
import { exec } from 'child_process';
import replace from 'lodash/replace';
import includes from 'lodash/includes';
import { configHandler, cliux as ux } from '@contentstack/cli-utilities';

import { print } from '../util';
import BaseClass from './base-class';
import { getRemoteUrls } from '../util/create-git-meta';
import { repositoriesQuery, userConnectionsQuery, importProjectMutation } from '../graphql';

export default class GitHub extends BaseClass {
  /**
   * @method run - initialization function
   *
   * @return {*}  {Promise<void>}
   * @memberof GitHub
   */
  async run(): Promise<void> {
    if (this.config.isExistingProject) {
      const environment = await this.getEnvironment();
      await this.handleExistingProject(environment);
    } else {
      await this.handleNewProject();
    }

    this.prepareLaunchConfig();
    await this.showLogs();
    this.showDeploymentUrl();
    this.showSuggestion();
  }

  private async handleExistingProject(environment:string): Promise<void> {
    await this.initApolloClient();

    const redeployLastUpload = this.config['redeploy-last-upload'];
    const redeployLatest = this.config['redeploy-latest'];

    if (redeployLastUpload) {
      this.log('redeploy-last-upload flag is not supported for Github Project.', 'error');
      this.exit(1);
    }

    if(!redeployLatest && !redeployLastUpload){
      await this.confirmLatestRedeployment();
    }

    await this.createNewDeployment(false, environment);
  }

  private async confirmLatestRedeployment(): Promise<void> {
    const deployLatestCommit = await ux.inquire({
      type: 'confirm',
      name: 'deployLatestCommit',
      message: 'Redeploy latest commit?',
    });
    if (!deployLatestCommit) {
      this.log('Cannot create a new project because its an existing project.', 'info');
      this.exit(1);
    }
  }

  private async handleNewProject(): Promise<void> {
    // NOTE Step 1: Check is Github connected
    if (await this.checkGitHubConnected()) {
      // NOTE Step 2: check is the git remote available in the user's repo list
      if (await this.checkGitRemoteAvailableAndValid()) {
        if (await this.checkUserGitHubAccess()) {
          // NOTE Step 3: check is the user has proper git access
          await this.prepareForNewProjectCreation();
        }
      }
    }
    await this.createNewProject();
  }

  /**
   * @method createNewProject - Create new launch project
   *
   * @return {*}  {Promise<void>}
   * @memberof GitHub
   */
  async createNewProject(): Promise<void> {
    const {
      branch,
      framework,
      repository,
      projectName,
      buildCommand,
      selectedStack,
      outputDirectory,
      environmentName,
      provider: gitProvider,
      serverCommand,
    } = this.config;
    const username = split(repository?.fullName, '/')[0];

    await this.apolloClient
      .mutate({
        mutation: importProjectMutation,
        variables: {
          project: {
            name: projectName,
            cmsStackApiKey: selectedStack?.api_key || '',
            repository: {
              username,
              repositoryUrl: repository?.url,
              repositoryName: repository?.fullName,
              gitProviderMetadata: { gitProvider },
            },
            environment: {
              gitBranch: branch,
              frameworkPreset: framework,
              outputDirectory: outputDirectory,
              name: environmentName || 'Default',
              environmentVariables: map(this.envVariables, ({ key, value }) => ({ key, value })),
              buildCommand: buildCommand === undefined || buildCommand === null ? 'npm run build' : buildCommand,
              serverCommand: serverCommand === undefined || serverCommand === null ? 'npm run start' : serverCommand,
            },
          },
        },
      })
      .then(({ data: { project } }) => {
        this.log('New project created successfully', 'info');
        const [firstEnvironment] = project.environments;
        this.config.currentConfig = project;
        this.config.currentConfig.deployments = map(firstEnvironment.deployments.edges, 'node');
        this.config.currentConfig.environments[0] = omit(this.config.currentConfig.environments[0], ['deployments']);
      })
      .catch(async (error) => {
        const canRetry = await this.handleNewProjectCreationError(error);

        if (canRetry) {
          return this.createNewProject();
        }
      });
  }

  /**
   * @method prepareForNewProjectCreation - Preparing all the data for new project creation
   *
   * @return {*}  {Promise<void>}
   * @memberof BaseClass
   */
  async prepareForNewProjectCreation(): Promise<void> {
    const {
      name,
      framework,
      environment,
      'build-command': buildCommand,
      'out-dir': outputDirectory,
      'variable-type': variableType,
      'env-variables': envVariables,
      'server-command': serverCommand,
      alias,
    } = this.config.flags;
    const { token, apiKey } = configHandler.get(`tokens.${alias}`) ?? {};
    this.config.selectedStack = apiKey;
    this.config.deliveryToken = token;
    await this.selectOrg();
    print([
      { message: '?', color: 'green' },
      { message: 'Repository', bold: true },
      { message: this.config.repository?.fullName, color: 'cyan' },
    ]);
    await this.selectBranch();
    this.config.projectName =
      name ||
      (await ux.inquire({
        type: 'input',
        name: 'projectName',
        message: 'Project Name',
        default: this.config.repository?.name,
        validate: this.inquireRequireValidation,
      }));
    this.config.environmentName =
      environment ||
      (await ux.inquire({
        type: 'input',
        default: 'Default',
        name: 'environmentName',
        message: 'Environment Name',
        validate: this.inquireRequireValidation,
      }));
    if (framework) {
      this.config.framework = (
        find(this.config.listOfFrameWorks, {
          name: framework,
        }) as Record<string, any>
      ).value as string;
      print([
        { message: '?', color: 'green' },
        { message: 'Framework Preset', bold: true },
        { message: this.config.framework, color: 'cyan' },
      ]);
    } else {
      await this.detectFramework();
    }
    this.config.buildCommand =
      buildCommand ||
      (await ux.inquire({
        type: 'input',
        name: 'buildCommand',
        message: 'Build Command',
        default: this.config.framework === 'OTHER' ? '' : 'npm run build',
      }));
    this.config.outputDirectory =
      outputDirectory ||
      (await ux.inquire({
        type: 'input',
        name: 'outputDirectory',
        message: 'Output Directory',
        default: (this.config.outputDirectories as Record<string, string>)[this.config?.framework || 'OTHER'],
      }));
    if (this.config.framework && this.config.supportedFrameworksForServerCommands.includes(this.config.framework)) {
      this.config.serverCommand =
        serverCommand ||
        (await ux.inquire({
          type: 'input',
          name: 'serverCommand',
          message: 'Server Command',
        }));
    }
    this.config.variableType = variableType as unknown as string;
    this.config.envVariables = envVariables;
    await this.handleEnvImportFlow();
  }

  /**
   * @method checkGitHubConnected - GitHub connection validation
   *
   * @return {*}  {(Promise<{
   *     userUid: string;
   *     provider: string;
   *   } | void>)}
   * @memberof GitHub
   */
  async checkGitHubConnected(): Promise<{
    userUid: string;
    provider: string;
  } | void> {
    const userConnections = await this.apolloClient
      .query({ query: userConnectionsQuery })
      .then(({ data: { userConnections } }) => userConnections)
      .catch((error) => this.log(error, 'error'));

    const userConnection = find(userConnections, {
      provider: this.config.provider,
    });

    if (userConnection) {
      this.log('GitHub connection identified!', 'info');
      this.config.userConnection = userConnection;
    } else {
      this.log('GitHub connection not found!', 'warn');
      await this.connectToAdapterOnUi();
    }

    return this.config.userConnection;
  }

  /**
   * @method checkGitRemoteAvailableAndValid - GitHub repository verification
   *
   * @return {*}  {(Promise<boolean | void>)}
   * @memberof GitHub
   */
  async checkGitRemoteAvailableAndValid(): Promise<boolean | void> {
    const localRemoteUrl = (await getRemoteUrls(resolve(this.config.projectBasePath, '.git/config')))?.origin || '';

    if (!localRemoteUrl) {
      this.log('GitHub project not identified!', 'error');
      await this.connectToAdapterOnUi();
    }

    const repositories = await this.apolloClient
      .query({ query: repositoriesQuery })
      .then(({ data: { repositories } }) => repositories)
      .catch((error) => this.log(error, 'error'));

    this.config.repository = find(repositories, {
      url: replace(localRemoteUrl, '.git', ''),
    });

    if (!this.config.repository) {
      this.log('Repository not found in the list!', 'error');
      this.exit(1);
    }

    return true;
  }

  /**
   * @method checkUserGitHubAccess - GitHub user access validation
   *
   * @return {*}  {Promise<boolean>}
   * @memberof GitHub
   */
  async checkUserGitHubAccess(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const self = this;
      const defaultBranch = this.config.repository?.defaultBranch;
      if (!defaultBranch) return reject('Branch not found');
      exec(
        `git push -u origin ${defaultBranch} --dry-run`,
        { cwd: this.config.projectBasePath },
        function (err, stdout, stderr) {
          if (err) {
            self.log(err, 'error');
          }

          if (
            includes(stderr, 'Everything up-to-date') &&
            includes(stdout, `Would set upstream of '${defaultBranch}' to '${defaultBranch}' of 'origin'`)
          ) {
            self.log('User access verified', 'info');
            return resolve(true);
          }

          self.log('You do not have write access for the selected repo', 'error');
          self.exit(0);
        },
      );
    });
  }
}
