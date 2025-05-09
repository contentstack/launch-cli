//@ts-nocheck
import { stub } from 'sinon';
import { Logger } from '../../../src/util';
import winston from 'winston';

describe('Log Util', () => {
  describe('getLoggerInstance', () => {
    let createLoggerStub;
    let processExitStub;
    const LoggerType = {
      ERROR: 'error',
    };
    beforeEach(() => {
      createLoggerStub = stub(winston, 'createLogger');
      if (!process.exit.restore) {
        processExitStub = stub(process, 'exit');
      } else {
        processExitStub = process.exit;
      }
    });

    afterEach(() => {
      createLoggerStub.restore();
      if (processExitStub.restore) {
        processExitStub.restore();
      }
    });

    it('should create a logger with file and console transports when project base path exists', () => {
      const loggerStub = {
        error: stub(),
      };
      createLoggerStub.returns(loggerStub);

      const loggerType = LoggerType.ERROR;
      const basePath = '/path/to/project';

      new Logger({ config: { projectBasePath: basePath } }).getLoggerInstance(loggerType);
    });
  });
});
