import BaseClass from './base-class';
import { cliux as ux, ContentstackClient } from '@contentstack/cli-utilities';
import config from '../config';
import exp from 'constants';

jest.mock('@contentstack/cli-utilities', () => ({
  cliux: {
    inquire: jest.fn(),
    table: jest.fn(),
  },
}));

describe('BaseClass', () => {
  let baseClass: BaseClass;
  let logMock: jest.Mock;
  let exitMock: jest.Mock;
  let managementSdkMock: jest.Mocked<ContentstackClient>;

  beforeEach(() => {
    logMock = jest.fn();
    exitMock = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleEnvImportFlow', () => {
    beforeEach(() => {
      baseClass = new BaseClass({
        log: logMock,
        exit: exitMock,
        config: config.variablePreparationTypeOptions,
      } as any);
    });
    it('should exit if no options are selected', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce([]);

      await baseClass.handleEnvImportFlow();

      expect(logMock).toHaveBeenCalledWith(
        'Please select at least one option by pressing <space>, then press <enter> to proceed.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should exit if "Skip adding environment variables" is selected with other options', async () => {
      const importEnvFromStackMock = jest.spyOn(baseClass, 'importEnvFromStack').mockResolvedValueOnce();
      (ux.inquire as jest.Mock).mockResolvedValueOnce([
        'Skip adding environment variables',
        'Import variables from a stack',
      ]);

      await baseClass.handleEnvImportFlow();

      expect(logMock).toHaveBeenCalledWith(
        "The 'Skip adding environment variables' option cannot be combined with other environment variable options. Please choose either 'Skip adding environment variables' or one or more of the other available options.",
        'error',
      );

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(importEnvFromStackMock).toHaveBeenCalled();
    });

    it('should call importEnvFromStack if "Import variables from a stack" is selected', async () => {
      const importEnvFromStackMock = jest.spyOn(baseClass, 'importEnvFromStack').mockResolvedValueOnce();

      (ux.inquire as jest.Mock).mockResolvedValueOnce(['Import variables from a stack']);

      await baseClass.handleEnvImportFlow();

      expect(importEnvFromStackMock).toHaveBeenCalled();
    });

    it('should call promptForEnvValues if "Manually add custom variables to the list" is selected', async () => {
      const promptForEnvValuesMock = jest.spyOn(baseClass, 'promptForEnvValues').mockResolvedValueOnce();

      (ux.inquire as jest.Mock).mockResolvedValueOnce(['Manually add custom variables to the list']);

      await baseClass.handleEnvImportFlow();

      expect(promptForEnvValuesMock).toHaveBeenCalled();
    });

    it('should call importVariableFromLocalConfig if "Import variables from the .env.local file" is selected', async () => {
      const importVariableFromLocalConfigMock = jest
        .spyOn(baseClass, 'importVariableFromLocalConfig')
        .mockResolvedValueOnce();

      (ux.inquire as jest.Mock).mockResolvedValueOnce(['Import variables from the .env.local file']);

      await baseClass.handleEnvImportFlow();

      expect(importVariableFromLocalConfigMock).toHaveBeenCalled();
    });

    it('should set envVariables to an empty array if "Skip adding environment variables" is selected', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce(['Skip adding environment variables']);

      await baseClass.handleEnvImportFlow();

      expect(baseClass.envVariables).toEqual([]);
      expect(logMock).toHaveBeenCalledWith('Skipped adding environment variables.', 'info');
    });

    it('should call importEnvFromStack and promptForEnvValues if "Import variables from a stack" and "Manually add custom variables to the list" both are selected.', async () => {
      const importEnvFromStackMock = jest.spyOn(baseClass, 'importEnvFromStack').mockResolvedValueOnce();
      const promptForEnvValuesMock = jest.spyOn(baseClass, 'promptForEnvValues').mockResolvedValueOnce();

      (ux.inquire as jest.Mock).mockResolvedValueOnce(['Import variables from a stack', 'Manually add custom variables to the list']);

      await baseClass.handleEnvImportFlow();

      expect(importEnvFromStackMock).toHaveBeenCalled();
      expect(promptForEnvValuesMock).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalledWith(1);
    });

    it('should call importVariableFromLocalConfig and importEnvFromStack if "Import variables from a stack" and "Import variables from the .env.local file" is selected', async () => {
      const importEnvFromStackMock = jest.spyOn(baseClass, 'importEnvFromStack').mockResolvedValueOnce();
      const importVariableFromLocalConfigMock = jest
        .spyOn(baseClass, 'importVariableFromLocalConfig')
        .mockResolvedValueOnce();
      (ux.inquire as jest.Mock).mockResolvedValueOnce([
        'Import variables from a stack',
        'Import variables from the .env.local file',
      ]);

      await baseClass.handleEnvImportFlow();

      expect(importEnvFromStackMock).toHaveBeenCalled();
      expect(importVariableFromLocalConfigMock).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalledWith(1);
    });

    it('should call promptForEnvValues and importVariableFromLocalConfig if "Manually add custom variables to the list" and "Import variables from the .env.local file" is selected', async () => {
      const promptForEnvValuesMock = jest.spyOn(baseClass, 'promptForEnvValues').mockResolvedValueOnce();
      const importVariableFromLocalConfigMock = jest
        .spyOn(baseClass, 'importVariableFromLocalConfig')
        .mockResolvedValueOnce();
      (ux.inquire as jest.Mock).mockResolvedValueOnce([
        'Manually add custom variables to the list',
        'Import variables from the .env.local file',
      ]);

      await baseClass.handleEnvImportFlow();

      expect(promptForEnvValuesMock).toHaveBeenCalled();
      expect(importVariableFromLocalConfigMock).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalledWith(1);
    });

    it('should call importEnvFromStack, promptForEnvValues and importVariableFromLocalConfig if all three options selected', async () => {
      const importEnvFromStackMock = jest.spyOn(baseClass, 'importEnvFromStack').mockResolvedValueOnce();
      const promptForEnvValuesMock = jest.spyOn(baseClass, 'promptForEnvValues').mockResolvedValueOnce();
      const importVariableFromLocalConfigMock = jest
        .spyOn(baseClass, 'importVariableFromLocalConfig')
        .mockResolvedValueOnce();
      (ux.inquire as jest.Mock).mockResolvedValueOnce([
        'Import variables from a stack',
        'Manually add custom variables to the list',
        'Import variables from the .env.local file',
      ]);

      await baseClass.handleEnvImportFlow(); 

      expect(importEnvFromStackMock).toHaveBeenCalled();
      expect(promptForEnvValuesMock).toHaveBeenCalled();
      expect(importVariableFromLocalConfigMock).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalledWith(1);
    });

    it('should call printAllVariables if envVariables has values', async () => {
      const expectedEnv = [{ key: 'API_KEY', value: '12345' }];
      const importVariableFromLocalConfigMock = jest
        .spyOn(baseClass, 'importVariableFromLocalConfig')
        .mockImplementationOnce(() => {
          baseClass.envVariables = expectedEnv;
          return Promise.resolve();
        });

      const printAllVariablesMock = jest.spyOn(baseClass, 'printAllVariables').mockImplementation();

      (ux.inquire as jest.Mock).mockResolvedValueOnce(['Import variables from the .env.local file']);

      await baseClass.handleEnvImportFlow();

      expect(importVariableFromLocalConfigMock).toHaveBeenCalled();
      expect(printAllVariablesMock).toHaveBeenCalled();
      expect(baseClass.envVariables).toEqual(expectedEnv);
    });
  });

  describe('importVariableFromLocalConfig', () => {
    jest.mock('dotenv', () => ({
      config: jest.fn().mockReturnValueOnce({ parsed: null }),
    }));

    beforeEach(() => {
      baseClass = new BaseClass({
        config: {
          projectBasePath: './baseClass',
        },
        log: logMock,
        exit: exitMock,
      } as any);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should log an error and exit if no .env.local file is found', async () => {
      jest.mock('dotenv', () => ({
        config: jest.fn().mockReturnValueOnce({ parsed: {} }),
      }));

      await baseClass.importVariableFromLocalConfig();

      expect(logMock).toHaveBeenCalledWith('No .env.local file found.', 'error');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('selectStack', () => {
    beforeEach(() => {
      managementSdkMock = {
        stack: jest.fn().mockReturnThis(),
        query: jest.fn().mockReturnThis(),
        find: jest.fn(),
      } as unknown as jest.Mocked<ContentstackClient>;

      baseClass = new BaseClass({
        log: logMock,
        exit: exitMock,
        managementSdk: managementSdkMock,
        config: {
          currentConfig: { organizationUid: 'org_uid' },
        },
      } as any);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should exit with error if no stacks are found', async () => {
      (managementSdkMock as any).find.mockResolvedValueOnce({ items: [] });
      exitMock.mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(baseClass.selectStack()).rejects.toThrow('exit');

      expect(logMock).toHaveBeenCalledWith(
        'No stacks were found in your organization, or you do not have access to any. Please create a stack in the organization to proceed in the organization.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('selectDeliveryToken', () => {
    beforeEach(() => {
      managementSdkMock = {
        stack: jest.fn().mockReturnThis(),
        deliveryToken: jest.fn().mockReturnThis(),
        query: jest.fn().mockReturnThis(),
        find: jest.fn(),
      } as unknown as jest.Mocked<ContentstackClient>;

      baseClass = new BaseClass({
        log: logMock,
        exit: exitMock,
        managementSdk: managementSdkMock,
        config: {
          selectedStack: { api_key: 'test_api_key' },
        },
      } as any);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should log an error and exit if no delivery tokens are found', async () => {
      (managementSdkMock as any).find.mockResolvedValueOnce({ items: [] });
      exitMock.mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(baseClass.selectDeliveryToken()).rejects.toThrow('exit');

      expect(logMock).toHaveBeenCalledWith(
        'No delivery tokens were found in the selected stack. Please create a delivery token in the stack to continue.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });
});
