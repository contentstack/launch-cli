import AdmZip from 'adm-zip';
import map from 'lodash/map';
import omit from 'lodash/omit';
import find from 'lodash/find';
import FormData from 'form-data';
import filter from 'lodash/filter';
import includes from 'lodash/includes';
import isEmpty from 'lodash/isEmpty';
import { basename, resolve } from 'path';
import { cliux, configHandler, HttpClient, ux } from '@contentstack/cli-utilities';
import { createReadStream, existsSync, PathLike, statSync, readFileSync } from 'fs';

import { print } from '../util';
import BaseClass from './base-class';
import { getFileList } from '../util/fs';
import { createSignedUploadUrlMutation, importProjectMutation } from '../graphql';
import { SignedUploadUrlData } from '../types/launch';

export default class FileUpload extends BaseClass {
  /**
   * @method run
   *
   * @return {*}  {Promise<void>}
   * @memberof FileUpload
   */
  async run(): Promise<void> {
    if (this.config.isExistingProject) {
      await this.handleExistingProject();
    } else {
      await this.handleNewProject();
    }

    this.prepareLaunchConfig();
    await this.showLogs();
    this.showDeploymentUrl();
    this.showSuggestion();
  }

  private async handleExistingProject(): Promise<void> {
    await this.initApolloClient();

    let redeployLatest = this.config['redeploy-latest'];

    let uploadUid;
    if (redeployLatest) {
      const signedUploadUrlData = await this.createSignedUploadUrl();
      uploadUid = signedUploadUrlData.uploadUid;
      const { zipName, zipPath } = await this.archive();
      await this.uploadFile(zipName, zipPath, signedUploadUrlData);
    }

    await this.createNewDeployment(true, uploadUid);
  }

  private async handleNewProject(): Promise<void> {
    const uploadUid = await this.prepareAndUploadNewProjectFile();
    await this.createNewProject(uploadUid);
  }

  /**
   * @method createNewProject - Create new launch project
   *
   * @return {*}  {Promise<void>}
   * @memberof FileUpload
   */
  async createNewProject(uploadUid: string): Promise<void> {
    const { framework, projectName, buildCommand, outputDirectory, environmentName, serverCommand } = this.config;
    await this.apolloClient
      .mutate({
        mutation: importProjectMutation,
        variables: {
          project: {
            projectType: 'FILEUPLOAD',
            name: projectName,
            fileUpload: { uploadUid },
            environment: {
              frameworkPreset: framework,
              outputDirectory: outputDirectory,
              name: environmentName || 'Default',
              environmentVariables: map(this.envVariables, ({ key, value }) => ({ key, value })),
              buildCommand: buildCommand === undefined || buildCommand === null ? 'npm run build' : buildCommand,
              serverCommand: serverCommand === undefined || serverCommand === null ? 'npm run start' : serverCommand,
            },
          },
          skipGitData: true,
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
          return this.createNewProject(uploadUid);
        }
      });
  }

  /**
   * @method prepareForNewProjectCreation - prepare necessary data for new project creation
   *
   * @return {*}  {Promise<void>}
   * @memberof FileUpload
   */
  async prepareAndUploadNewProjectFile(): Promise<string> {
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
    // this.fileValidation();
    await this.selectOrg();
    const signedUploadUrlData = await this.createSignedUploadUrl();
    const { zipName, zipPath, projectName } = await this.archive();
    await this.uploadFile(zipName, zipPath, signedUploadUrlData);
    this.config.projectName =
      name ||
      (await cliux.inquire({
        type: 'input',
        name: 'projectName',
        message: 'Project Name',
        default: projectName,
        validate: this.inquireRequireValidation,
      }));
    this.config.environmentName =
      environment ||
      (await cliux.inquire({
        type: 'input',
        default: 'Default',
        name: 'environmentName',
        message: 'Environment Name',
        validate: this.inquireRequireValidation,
      }));
    if (framework) {
      this.config.framework = ((
        find(this.config.listOfFrameWorks, {
          name: framework,
        }) as Record<string, any>
      ).value || '') as string;
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
      (await cliux.inquire({
        type: 'input',
        name: 'buildCommand',
        message: 'Build Command',
        default: this.config.framework === 'OTHER' ? null : 'npm run build',
      }));
    this.config.outputDirectory =
      outputDirectory ||
      (await cliux.inquire({
        type: 'input',
        name: 'outputDirectory',
        message: 'Output Directory',
        default: (this.config.outputDirectories as Record<string, string>)[this.config?.framework || 'OTHER'],
      }));
    if (this.config.framework && this.config.supportedFrameworksForServerCommands.includes(this.config.framework)) {
      this.config.serverCommand =
        serverCommand ||
        (await cliux.inquire({
          type: 'input',
          name: 'serverCommand',
          message: 'Server Command',
        }));
    }
    this.config.variableType = variableType as unknown as string;
    this.config.envVariables = envVariables;
    await this.handleEnvImportFlow();
    return signedUploadUrlData.uploadUid;
  }

  /**
   * @method fileValidation - validate the working directory
   *
   * @memberof FileUpload
   */
  fileValidation() {
    const basePath = this.config.projectBasePath;
    const packageJsonPath = resolve(basePath, 'package.json');

    if (!existsSync(packageJsonPath)) {
      this.log('Package.json file not found.', 'info');
      this.exit(1);
    }
  }

  /**
   * @method archive - Archive the files and directory to be uploaded for launch project
   *
   * @return {*}
   * @memberof FileUpload
   */
  async archive() {
    ux.action.start('Preparing zip file');
    const projectName = basename(this.config.projectBasePath);
    const zipName = `${Date.now()}_${projectName}.zip`;
    const zipPath = resolve(this.config.projectBasePath, zipName);
    const zip = new AdmZip();
    const zipEntries = filter(
      await getFileList(this.config.projectBasePath, true, true),
      (entry) => !includes(this.config.fileUploadConfig.exclude, entry) && !includes(entry, '.zip'),
    );

    for (const entry of zipEntries) {
      const entryPath = `${this.config.projectBasePath}/${entry}`;
      const state = statSync(entryPath);

      switch (true) {
        case state.isDirectory(): // NOTE folder
          zip.addLocalFolder(entryPath, entry);
          break;
        case state.isFile(): // NOTE check is file
          zip.addLocalFile(entryPath);
          break;
      }
    }

    const status = await zip.writeZipPromise(zipPath).catch(() => {
      this.log('Zipping project process failed! Please try again.');
      this.exit(1);
    });

    if (!status) {
      this.log('Zipping project process failed! Please try again.');
      this.exit(1);
    }

    ux.action.stop();
    return { zipName, zipPath, projectName };
  }

  /**
   * @method createSignedUploadUrl - create pre signed url for file upload
   *
   * @return {*}  {Promise<SignedUploadUrlData>}
   * @memberof FileUpload
   */
  async createSignedUploadUrl(): Promise<SignedUploadUrlData> {
    try {
      const result = await this.apolloClient.mutate({ mutation: createSignedUploadUrlMutation });
      const signedUploadUrlData = result.data.signedUploadUrl;
      this.config.uploadUid = signedUploadUrlData.uploadUid;
      return signedUploadUrlData;
    } catch (error) {
      this.log('Something went wrong. Please try again.', 'warn');
      if (error instanceof Error) {
        this.log(error.message, 'error');
      }
      this.exit(1);
      return {} as SignedUploadUrlData;
    }
  }

  /**
   * @method uploadFile - Upload file in to s3 bucket
   *
   * @param {string} fileName
   * @param {PathLike} filePath
   * @return {*}  {Promise<void>}
   * @memberof FileUpload
   */
  async uploadFile(fileName: string, filePath: PathLike, signedUploadUrlData: SignedUploadUrlData): Promise<void> {
    const { uploadUrl, fields, headers, method } = signedUploadUrlData;
    const formData = new FormData();

    if (!isEmpty(fields)) {
      for (const { formFieldKey, formFieldValue } of fields) {
        formData.append(formFieldKey, formFieldValue);
      }

      formData.append('file', createReadStream(filePath), fileName);
      await this.submitFormData(formData, uploadUrl);
    } else if (method === 'PUT') {
      await this.uploadWithHttpClient(filePath, uploadUrl, headers);
    }
  }

  private async submitFormData(formData: FormData, uploadUrl: string): Promise<void> {
    ux.action.start('Starting file upload...');
    try {
      await new Promise<void>((resolve, reject) => {
        formData.submit(uploadUrl, (error, res) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      ux.action.stop();
    } catch (error) {
      ux.action.stop('File upload failed!');
      this.log('File upload failed. Please try again.', 'error');
      if (error instanceof Error) {
        this.log(error.message, 'error');
      }
      this.exit(1);
    }
  }

  private async uploadWithHttpClient(
    filePath: PathLike,
    uploadUrl: string,
    headers: Array<{ key: string; value: string }>,
  ): Promise<void> {
    ux.action.start('Starting file upload...');
    const httpClient = new HttpClient();
    const file = readFileSync(filePath);

    // Convert headers array to a headers object
    const headerObject = headers?.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    try {
      httpClient.headers({ 'Content-Type': 'application/zip' });
      if (headerObject !== undefined) httpClient.headers(headerObject);
      const response = (await httpClient.put(uploadUrl, file)) as any;
      const { status } = response;

      if (status >= 200 && status < 300) {
        ux.action.stop();
      } else {
        ux.action.stop('File upload failed!');
        this.log('File upload failed. Please try again.', 'error');
        this.log(`Error: ${status}, ${response?.statusText}`, 'error');
        this.exit(1);
      }
    } catch (error) {
      ux.action.stop('File upload failed!');
      this.log('File upload failed. Please try again.', 'error');
      if (error instanceof Error) {
        this.log(`Error: ${error.message}`, 'error');
      }
      this.exit(1);
    }
  }
}
