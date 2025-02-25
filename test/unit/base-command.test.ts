//@ts-nocheck
// TODO: Allow ts with any and remove ts-nocheck
import { expect } from 'chai';
import { stub, createSandbox } from 'sinon';
import { cliux as ux, configHandler } from '@contentstack/cli-utilities';
import fs from 'fs';
import path from 'path';
import { BaseCommand } from '../../src/base-command';
import config from '../../src/config';
import { getLaunchHubUrl } from '../../src/util';

describe('BaseCommand', () => {
  let sandbox;
  let baseCommandInstance;
  let flags;

  describe('prepareConfig', () => {
    let statSyncResultObj;
    let statSyncStub;
    let existsSyncStub;
    let processCwdStub;

    beforeEach(() => {
      sandbox = createSandbox();

      baseCommandInstance = new (class extends BaseCommand<typeof BaseCommand> {
        async run() {}
      })([], {} as any);

      baseCommandInstance.flags = {};

      baseCommandInstance.exit = sandbox.stub().callsFake((code) => {
        throw new Error(code);
      });

      statSyncResultObj = {
        isDirectory: sandbox.stub().returns(true),
      };
      statSyncStub = sandbox.stub(fs, 'statSync').returns(statSyncResultObj);

      existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);

      processCwdStub = sandbox.stub(process, 'cwd').returns('/root/');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should initialize sharedConfig with default values if no flags passed', async () => {

      await baseCommandInstance.prepareConfig();

      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        projectBasePath: '/root/',
        config: '/root/.cs-launch.json',
      });
    });

    it('should successfully initialize sharedConfig.projectBasePath if "data-dir" flag is passed', async () => {
      baseCommandInstance.flags = {
        'data-dir': '/root/subdirectory/project1',
      };

      await baseCommandInstance.prepareConfig();

      expect(existsSyncStub.args[0][0]).to.equal('/root/subdirectory/project1');
      expect(statSyncStub.args[0][0]).to.equal('/root/subdirectory/project1');
      expect(statSyncResultObj.isDirectory.calledOnce).to.be.true;
      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        projectBasePath: '/root/subdirectory/project1',
        config: '/root/.cs-launch.json'
      });
    });

    it('should exit with error if "data-dir" flag specified but path does not exist', async () => {
      existsSyncStub.returns(false);
      baseCommandInstance.flags = {
        'data-dir': '/root/subdirectory/project1',
      };
      let exitStatusCode;

      try {
        await baseCommandInstance.prepareConfig();
      } catch (err) {
        exitStatusCode = err.message;
      }

      expect(existsSyncStub.args[0][0]).to.equal('/root/subdirectory/project1');
      expect(exitStatusCode).to.equal('1');
    });

    it('should exit with error if "data-dir" flag specified with a non-directory path', async () => {
      statSyncResultObj.isDirectory.returns(false);
      baseCommandInstance.flags = {
        'data-dir': '/root/subdirectory/project1/file.txt',
      };
      let exitStatusCode;

      try {
        await baseCommandInstance.prepareConfig();
      } catch (err) {
        exitStatusCode = err.message;
      }

      expect(existsSyncStub.args[0][0]).to.equal('/root/subdirectory/project1/file.txt');
      expect(statSyncStub.args[0][0]).to.equal('/root/subdirectory/project1/file.txt');
      expect(statSyncResultObj.isDirectory.calledOnce).to.be.true;
      expect(exitStatusCode).to.equal('1');
    });

    it('should initialize sharedConfig.config if "config" flag if passed', async () => {
      baseCommandInstance.flags = {
        config: '/root/subdirectory/configs/dev.json',
      };

      await baseCommandInstance.prepareConfig();

      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        projectBasePath: '/root/',
        config: '/root/subdirectory/configs/dev.json',
      });
    });

  });
});
