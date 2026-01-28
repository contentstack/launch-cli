import Functions from './functions';
import { Logger } from '../../util';
import { Contentfly } from '../../util/cloud-function/contentfly';

jest.mock('../../util');
jest.mock('../../util/cloud-function/contentfly');

describe('Functions Command', () => {
  describe('init', () => {
    let originalParseMethod: (typeof Functions.prototype)['parse'];
    let logMock: jest.Mock;

    beforeEach(() => {
      originalParseMethod = Functions.prototype['parse'];

      logMock = jest.fn();
      (Logger as jest.Mock).mockImplementation(() => ({
        log: logMock,
      }));

      Functions.prototype['parse'] = jest
        .fn()
        .mockResolvedValueOnce({ flags: { 'data-dir': '/path/to/data/dir', port: '4000' } });
    });

    afterEach(() => {
      Functions.prototype['parse'] = originalParseMethod;
      jest.resetAllMocks();
    });

    it('should initialize the command and set the sharedConfig values', async () => {
      const functionsCommand = new Functions([], {} as any);

      await functionsCommand.init();

      expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
      expect(functionsCommand['sharedConfig']).toEqual({
        projectBasePath: '/path/to/data/dir',
        port: 4000,
      });
    });

    it('should fall back to process.cwd() when data-dir flag is not provided', async () => {
      Functions.prototype['parse'] = jest
        .fn()
        .mockResolvedValueOnce({ flags: { 'data-dir': undefined, port: '3000' } });
      const functionsCommand = new Functions([], {} as any);

      await functionsCommand.init();

      expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
      expect(functionsCommand['sharedConfig']).toEqual({
        projectBasePath: process.cwd(),
        port: 3000,
      });
    });

    it.each([{ portFlagInput: 'invalidPortInput' }, { portFlagInput: '999999' }, { portFlagInput: '-200' }])(
      'should log an error and exit if the "port" flag input is invalid -> $portFlagInput',
      async ({ portFlagInput }) => {
        Functions.prototype['parse'] = jest
          .fn()
          .mockResolvedValueOnce({ flags: { 'data-dir': '/path/to/data/dir', port: portFlagInput } });
        const exitMock = jest.spyOn(Functions.prototype, 'exit').mockImplementation();
        const functionsCommand = new Functions([], {} as any);

        await functionsCommand.init();

        expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
        expect(logMock).toHaveBeenCalledWith(
          'Invalid port number. Please provide a valid port number between 0 and 65535.',
          'error',
        );
        expect(exitMock).toHaveBeenCalledWith(1);
      },
    );

    describe('init -> environment variable input handling', () => {
      const originalProcessEnv = { ...process.env };

      afterEach(() => {
        process.env = originalProcessEnv;
      });

      it('should set the port based on the PORT environment variable', async () => {
        process.env.PORT = '5000';
        const functionsCommand = new Functions([], {} as any);

        await functionsCommand.init();

        expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
        expect(functionsCommand['sharedConfig']).toEqual({
          projectBasePath: '/path/to/data/dir',
          port: 5000,
        });
      });

      it.each([
        { portEnvironmentVariableValue: 'invalidPortInput' },
        { portEnvironmentVariableValue: '999999' },
        { portEnvironmentVariableValue: '-200' },
      ])(
        'should log an error and exit if the "PORT" environment variable value is invalid -> $portEnvironmentVariableValue',
        async ({ portEnvironmentVariableValue }) => {
          process.env.PORT = portEnvironmentVariableValue;
          const exitMock = jest.spyOn(Functions.prototype, 'exit').mockImplementation();
          const functionsCommand = new Functions([], {} as any);

          await functionsCommand.init();

          expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
          expect(logMock).toHaveBeenCalledWith(
            'Invalid port number. Please provide a valid port number between 0 and 65535.',
            'error',
          );
          expect(exitMock).toHaveBeenCalledWith(1);
        },
      );
    });
  });

  describe('run', () => {
    let serveCloudFunctionsMock: jest.Mock;

    beforeEach(() => {
      serveCloudFunctionsMock = jest.fn();
      (Contentfly as jest.Mock).mockImplementation(() => ({
        serveCloudFunctions: serveCloudFunctionsMock,
      }));
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should call serveCloudFunctions with the correct port', async () => {
      const functionsCommand = new Functions([], {} as any);
      functionsCommand['sharedConfig'] = {
        projectBasePath: '/path/to/data/dir',
        port: 4000,
      };

      await functionsCommand.run();

      expect(Contentfly).toHaveBeenCalledWith('/path/to/data/dir');
      expect(serveCloudFunctionsMock).toHaveBeenCalledWith(4000);
    });
  });
});
