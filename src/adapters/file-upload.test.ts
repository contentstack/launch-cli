import FileUpload from './file-upload';
import BaseClass from './base-class';
import { cliux } from '@contentstack/cli-utilities';
import { DeploymentStatus } from '../types/launch';

jest.mock('@contentstack/cli-utilities', () => ({
  ...jest.requireActual('@contentstack/cli-utilities'),
  cliux: {
    inquire: jest.fn(),
    loader: jest.fn(),
    print: jest.fn(),
  },
  configHandler: {
    get: jest.fn(),
  },
  HttpClient: jest.fn(),
}));

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
  });
});

