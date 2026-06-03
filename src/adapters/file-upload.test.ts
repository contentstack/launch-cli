import { fileUploadAdapter as cliUtilitiesJestMock } from '../test/mocks/cli-utilities';
import FileUpload from './file-upload';
import BaseClass from './base-class';
import { cliux } from '@contentstack/cli-utilities';
import { DeploymentStatus } from '../types/launch';

jest.mock('@contentstack/cli-utilities', () => cliUtilitiesJestMock);

describe('FileUpload Adapter', () => {
  let logMock: jest.Mock;
  let exitMock: jest.Mock;

  beforeEach(() => {
    logMock = jest.fn();
    exitMock = jest.fn().mockImplementation(() => {
      throw new Error('1');
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('runFileUploadFlow', () => {
    let getEnvironmentMock: jest.SpyInstance;
    let handleExistingProjectMock: jest.SpyInstance;
    let handleNewProjectMock: jest.SpyInstance;
    let prepareLaunchConfigMock: jest.SpyInstance;
    let showLogsMock: jest.SpyInstance;
    let showDeploymentUrlMock: jest.SpyInstance;
    let showSuggestionMock: jest.SpyInstance;

    beforeEach(() => {
      getEnvironmentMock = jest
        .spyOn(BaseClass.prototype, 'getEnvironment')
        .mockResolvedValue({ uid: 'env-123', name: 'Default', frameworkPreset: 'OTHER' });
      handleExistingProjectMock = jest
        .spyOn(FileUpload.prototype as any, 'handleExistingProject')
        .mockResolvedValue(undefined);
      handleNewProjectMock = jest
        .spyOn(FileUpload.prototype as any, 'handleNewProject')
        .mockResolvedValue(undefined);
      prepareLaunchConfigMock = jest.spyOn(BaseClass.prototype, 'prepareLaunchConfig').mockImplementation(() => {});
      showLogsMock = jest.spyOn(BaseClass.prototype, 'showLogs').mockResolvedValue(true);
      showDeploymentUrlMock = jest.spyOn(BaseClass.prototype, 'showDeploymentUrl').mockImplementation(() => {});
      showSuggestionMock = jest.spyOn(BaseClass.prototype, 'showSuggestion').mockImplementation(() => {});
    });

    afterEach(() => {
      getEnvironmentMock.mockRestore();
      handleExistingProjectMock.mockRestore();
      handleNewProjectMock.mockRestore();
      prepareLaunchConfigMock.mockRestore();
      showLogsMock.mockRestore();
      showDeploymentUrlMock.mockRestore();
      showSuggestionMock.mockRestore();
    });

    it('should exit with code 1 when deployment status is FAILED for existing project', async () => {
      const fileUploadInstance = new FileUpload({
        config: {
          isExistingProject: true,
          currentDeploymentStatus: DeploymentStatus.FAILED,
        },
        log: logMock,
        exit: exitMock,
      } as any);

      try {
        await fileUploadInstance.run();
      } catch (error: any) {
        expect(error.message).toBe('1');
      }

      expect(getEnvironmentMock).toHaveBeenCalled();
      expect(handleExistingProjectMock).toHaveBeenCalled();
      expect(prepareLaunchConfigMock).toHaveBeenCalled();
      expect(showLogsMock).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(showDeploymentUrlMock).not.toHaveBeenCalled();
      expect(showSuggestionMock).not.toHaveBeenCalled();
    });

    it('should exit with code 1 when deployment status is FAILED for new project', async () => {
      const fileUploadInstance = new FileUpload({
        config: {
          isExistingProject: false,
          currentDeploymentStatus: DeploymentStatus.FAILED,
        },
        log: logMock,
        exit: exitMock,
      } as any);

      try {
        await fileUploadInstance.run();
      } catch (error: any) {
        expect(error.message).toBe('1');
      }

      expect(handleNewProjectMock).toHaveBeenCalled();
      expect(prepareLaunchConfigMock).toHaveBeenCalled();
      expect(showLogsMock).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(showDeploymentUrlMock).not.toHaveBeenCalled();
      expect(showSuggestionMock).not.toHaveBeenCalled();
    });

    it('should continue normally when deployment status is not FAILED', async () => {
      const fileUploadInstance = new FileUpload({
        config: {
          isExistingProject: true,
          currentDeploymentStatus: DeploymentStatus.LIVE,
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.run();

      expect(getEnvironmentMock).toHaveBeenCalled();
      expect(handleExistingProjectMock).toHaveBeenCalled();
      expect(prepareLaunchConfigMock).toHaveBeenCalled();
      expect(showLogsMock).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
      expect(showDeploymentUrlMock).toHaveBeenCalled();
      expect(showSuggestionMock).toHaveBeenCalled();
    });
  });

  describe('prepareAndUploadNewProjectFile', () => {
    let selectOrgMock: jest.SpyInstance;
    let createSignedUploadUrlMock: jest.SpyInstance;
    let archiveMock: jest.SpyInstance;
    let uploadFileMock: jest.SpyInstance;
    let detectFrameworkMock: jest.SpyInstance;
    let handleEnvImportFlowMock: jest.SpyInstance;

    beforeEach(() => {
      selectOrgMock = jest.spyOn(BaseClass.prototype, 'selectOrg').mockResolvedValue();
      createSignedUploadUrlMock = jest.spyOn(FileUpload.prototype, 'createSignedUploadUrl').mockResolvedValue({
        uploadUid: 'upload-123',
        uploadUrl: 'https://example.com/upload',
        fields: [],
        headers: [],
        method: 'PUT',
      });
      archiveMock = jest.spyOn(FileUpload.prototype, 'archive').mockResolvedValue({
        zipName: 'test.zip',
        zipPath: '/path/to/test.zip',
        projectName: 'test-project',
      });
      uploadFileMock = jest.spyOn(FileUpload.prototype, 'uploadFile').mockResolvedValue();
      detectFrameworkMock = jest.spyOn(BaseClass.prototype, 'detectFramework').mockResolvedValue();
      handleEnvImportFlowMock = jest.spyOn(BaseClass.prototype, 'handleEnvImportFlow').mockResolvedValue();
    });

    afterEach(() => {
      selectOrgMock.mockRestore();
      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
      detectFrameworkMock.mockRestore();
      handleEnvImportFlowMock.mockRestore();
    });

    it('should prompt for server command when framework supports it and serverCommand is not provided', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); // projectName
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default'); // environmentName
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); // buildCommand
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); // outputDirectory
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm start'); // serverCommand

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: 'OTHER',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      expect(cliux.inquire).toHaveBeenCalledWith({
        type: 'input',
        name: 'serverCommand',
        message: 'Server Command',
      });
      expect(fileUploadInstance.config.serverCommand).toBe('npm start');
    });

    it('should not prompt for server command when framework does not support it', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: 'GATSBY',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const serverCommandCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
    });

    it('should not prompt for server command when serverCommand is already provided in flags', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': 'npm run serve',
          },
          framework: 'OTHER',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const serverCommandCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
      expect(fileUploadInstance.config.flags['server-command']).toBe('npm run serve');
    });

    it('should not set serverCommand when user provides empty input', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce(''); 

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: 'OTHER',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      expect(cliux.inquire).toHaveBeenCalledWith({
        type: 'input',
        name: 'serverCommand',
        message: 'Server Command',
      });
      expect(fileUploadInstance.config.serverCommand).toBeUndefined();
    });

    it('should not prompt for server command when framework is not set', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: undefined,
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const serverCommandCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
    });

    it('should prompt Enable Streaming Responses after server command when response-mode omitted for OTHER preset',
      async () => {
        (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
        (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
        (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
        (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist');
        (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm start');
        (cliux.inquire as jest.Mock).mockResolvedValueOnce('streaming');

        const createSignedUploadUrlMock = jest
          .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
          .mockResolvedValue({ uploadUid: 'test-upload-uid' });
        const archiveMock = jest
          .spyOn(FileUpload.prototype as any, 'archive')
          .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
        const uploadFileMock = jest
          .spyOn(FileUpload.prototype as any, 'uploadFile')
          .mockResolvedValue(undefined);

        const fileUploadInstance = new FileUpload({
          config: {
            flags: {
              'server-command': undefined,
              'response-mode': undefined,
            },
            framework: 'OTHER',
            supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
            outputDirectories: { OTHER: './dist' },
          },
          log: logMock,
          exit: exitMock,
        } as any);

        await fileUploadInstance.prepareAndUploadNewProjectFile();

        expect(cliux.inquire).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'list',
            name: 'responseMode',
            message: 'Choose a response mode',
            default: 'buffered',
            choices: [
              { name: 'Buffered', value: 'buffered' },
              { name: 'Streaming', value: 'streaming' },
            ],
          }),
        );
        expect(fileUploadInstance.config.isStreamingEnabled).toBe(true);

        createSignedUploadUrlMock.mockRestore();
        archiveMock.mockRestore();
        uploadFileMock.mockRestore();
      });

    it('should not prompt Enable Streaming Response when response-mode flag is streaming', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist');

      const createSignedUploadUrlMock = jest
        .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
        .mockResolvedValue({ uploadUid: 'test-upload-uid' });
      const archiveMock = jest
        .spyOn(FileUpload.prototype as any, 'archive')
        .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
      const uploadFileMock = jest
        .spyOn(FileUpload.prototype as any, 'uploadFile')
        .mockResolvedValue(undefined);

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': 'npm start',
            'response-mode': 'streaming',
          },
          framework: 'OTHER',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const enableStreamingCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'responseMode',
      );
      expect(enableStreamingCalls.length).toBe(0);
      expect(fileUploadInstance.config.isStreamingEnabled).toBe(true);

      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
    });

    it('should not prompt Enable Streaming Response when response-mode flag is buffered', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./dist');

      const createSignedUploadUrlMock = jest
        .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
        .mockResolvedValue({ uploadUid: 'test-upload-uid' });
      const archiveMock = jest
        .spyOn(FileUpload.prototype as any, 'archive')
        .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
      const uploadFileMock = jest
        .spyOn(FileUpload.prototype as any, 'uploadFile')
        .mockResolvedValue(undefined);

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'server-command': 'npm start',
            'response-mode': 'buffered',
          },
          framework: 'OTHER',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const enableStreamingCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'responseMode',
      );
      expect(enableStreamingCalls.length).toBe(0);
      expect(fileUploadInstance.config.isStreamingEnabled).toBe(false);

      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
    });

    it('should prompt Enable Streaming Responses for Gatsby when flag is not provided', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('streaming');

      const createSignedUploadUrlMock = jest
        .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
        .mockResolvedValue({ uploadUid: 'test-upload-uid' });
      const archiveMock = jest
        .spyOn(FileUpload.prototype as any, 'archive')
        .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
      const uploadFileMock = jest
        .spyOn(FileUpload.prototype as any, 'uploadFile')
        .mockResolvedValue(undefined);

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'response-mode': undefined,
          },
          framework: 'GATSBY',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(fileUploadInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const serverCommandCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
      expect(cliux.inquire).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'list',
          name: 'responseMode',
          message: 'Choose a response mode',
          default: 'buffered',
          choices: [
            { name: 'Buffered', value: 'buffered' },
            { name: 'Streaming', value: 'streaming' },
          ],
        }),
      );
      expect(fileUploadInstance.config.isStreamingEnabled).toBe(true);

      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
      handleEnvImportFlowMock.mockRestore();
    });

    it('should apply response-mode flag for Gatsby without prompt', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./public');

      const createSignedUploadUrlMock = jest
        .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
        .mockResolvedValue({ uploadUid: 'test-upload-uid' });
      const archiveMock = jest
        .spyOn(FileUpload.prototype as any, 'archive')
        .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
      const uploadFileMock = jest
        .spyOn(FileUpload.prototype as any, 'uploadFile')
        .mockResolvedValue(undefined);

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'response-mode': 'buffered',
          },
          framework: 'GATSBY',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(fileUploadInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const enableStreamingCalls = (cliux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'responseMode',
      );
      expect(enableStreamingCalls.length).toBe(0);
      expect(fileUploadInstance.config.isStreamingEnabled).toBe(false);

      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
      handleEnvImportFlowMock.mockRestore();
    });

    it.each([
      ['streaming', true],
      ['buffered', false],
    ])('should map Response Mode selection "%s" to isStreamingEnabled %s', async (input, expected) => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce(input);

      const createSignedUploadUrlMock = jest
        .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
        .mockResolvedValue({ uploadUid: 'test-upload-uid' });
      const archiveMock = jest
        .spyOn(FileUpload.prototype as any, 'archive')
        .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
      const uploadFileMock = jest
        .spyOn(FileUpload.prototype as any, 'uploadFile')
        .mockResolvedValue(undefined);

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'response-mode': undefined,
          },
          framework: 'GATSBY',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(fileUploadInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      expect(fileUploadInstance.config.isStreamingEnabled).toBe(expected);

      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
      handleEnvImportFlowMock.mockRestore();
    });

    it('Response Mode prompt should offer buffered and streaming choices', async () => {
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (cliux.inquire as jest.Mock).mockResolvedValueOnce('streaming');

      const createSignedUploadUrlMock = jest
        .spyOn(FileUpload.prototype as any, 'createSignedUploadUrl')
        .mockResolvedValue({ uploadUid: 'test-upload-uid' });
      const archiveMock = jest
        .spyOn(FileUpload.prototype as any, 'archive')
        .mockResolvedValue({ zipName: 'test.zip', zipPath: '/path/to/test.zip', projectName: 'test-project' });
      const uploadFileMock = jest
        .spyOn(FileUpload.prototype as any, 'uploadFile')
        .mockResolvedValue(undefined);

      const fileUploadInstance = new FileUpload({
        config: {
          flags: {
            'response-mode': undefined,
          },
          framework: 'GATSBY',
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(fileUploadInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await fileUploadInstance.prepareAndUploadNewProjectFile();

      const responseModeCall = (cliux.inquire as jest.Mock).mock.calls.find(
        (call) => call[0]?.name === 'responseMode',
      );

      expect(responseModeCall[0].type).toBe('list');
      expect(responseModeCall[0].choices).toEqual([
        { name: 'Buffered', value: 'buffered' },
        { name: 'Streaming', value: 'streaming' },
      ]);

      createSignedUploadUrlMock.mockRestore();
      archiveMock.mockRestore();
      uploadFileMock.mockRestore();
      handleEnvImportFlowMock.mockRestore();
    });
  });
});

