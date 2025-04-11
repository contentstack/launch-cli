import BaseClass from './base-class';
import { cliux as ux } from '@contentstack/cli-utilities';
import config from '../config';

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
    
    it('should call printAllVariables if envVariables has values', async () => {
      const expectedEnv = [{ key: 'API_KEY', value: '12345' }];
      const importVariableFromLocalConfigMock = jest
        .spyOn(baseClass, 'importVariableFromLocalConfig')
        .mockImplementationOnce(() => {
          baseClass.envVariables = expectedEnv;
          return Promise.resolve();
        });
    
      const printAllVariablesMock = jest
        .spyOn(baseClass, 'printAllVariables')
        .mockImplementation();
    
      (ux.inquire as jest.Mock).mockResolvedValueOnce([
        'Import variables from the .env.local file',
      ]);
    
      await baseClass.handleEnvImportFlow();
    
      expect(importVariableFromLocalConfigMock).toHaveBeenCalled();
      expect(printAllVariablesMock).toHaveBeenCalled();
      expect(baseClass.envVariables).toEqual(expectedEnv);
    });
    
  });
  
  describe('importVariableFromLocalConfig', () => {  
    jest.mock('dotenv', () => ({
      config: jest.fn().mockReturnValueOnce({ parsed: null })
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
      config: jest.fn().mockReturnValueOnce({ parsed: {} })
    }));

      await baseClass.importVariableFromLocalConfig();
  
      expect(logMock).toHaveBeenCalledWith('No .env.local file found.', 'error');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });
});
