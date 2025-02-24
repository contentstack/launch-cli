//@ts-nocheck
// TODO: Allow ts with any and remove ts-nocheck
import { expect } from 'chai';
import { stub, createSandbox } from 'sinon';
import { cliux as ux, configHandler } from '@contentstack/cli-utilities';
import fs from 'fs';
import path from 'path';
import { BaseCommand } from '../../src/base-command';
import config from '../../src/config';
import * as commonUtils from '../../src/util/common-utility';

describe('BaseCommand', () => {
  let sandbox;
  let baseCommandInstance;
  let flags;

  describe('prepareConfig', () => {
    let statSyncResultObj;
    let statSyncStub;
    let existsSyncStub;
    let processCwdStub;
    let getLaunchHubUrlStub;
    let configHandlerGetStub;

    beforeEach(() => {
      sandbox = createSandbox();

      baseCommandInstance = new (class extends BaseCommand<typeof BaseCommand> {
        async run() {}
      })([], {} as any);

      baseCommandInstance.flags = {};

      sandbox.stub(BaseCommand.prototype, 'exit').callsFake((code) => {
        throw new Error(code);
      });

      statSyncResultObj = {
        isDirectory: sandbox.stub().returns(true),
      };
      statSyncStub = sandbox.stub(fs, 'statSync').returns(statSyncResultObj);

      existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);
      existsSyncStub.withArgs('/root/.cs-launch.json').returns(false);

      processCwdStub = sandbox.stub(process, 'cwd').returns('/root/');

      getLaunchHubUrlStub = sandbox
        .stub(commonUtils, 'getLaunchHubUrl')
        .returns('https://dev11-app.csnonprod.com/launch-api');

      sandbox.stub(BaseCommand.prototype, 'cmaHost').value('host.contentstack.io');
      
      configHandlerGetStub = sandbox.stub(configHandler, 'get').returns('testValue');
      configHandlerGetStub.withArgs('authtoken').returns('testauthtoken');
      configHandlerGetStub.withArgs('authorisationType').returns('testauthorisationType');
      configHandlerGetStub.withArgs('oauthAccessToken').returns('testoauthAccessToken');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should initialize sharedConfig with default values if no flags passed', async () => {
      await baseCommandInstance.prepareConfig();

      expect(configHandlerGetStub.args[1][0]).to.equal('authtoken');
      expect(configHandlerGetStub.args[2][0]).to.equal('authorisationType');
      expect(configHandlerGetStub.args[3][0]).to.equal('oauthAccessToken');
      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        flags: {},
        host: 'host.contentstack.io',
        projectBasePath: '/root/',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        config: '/root/.cs-launch.json',
        logsApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/manage/graphql',
      });
    });

    it('should successfully initialize sharedConfig.manageApiBaseUrl and sharedConfig.logsApiBaseUrl if config.launchBaseUrl is set', async () => {
      sandbox.stub(config, 'launchBaseUrl').value('https://configlaunch-baseurl.csnonprod.com/launch-api');

      await baseCommandInstance.prepareConfig();

      expect(existsSyncStub.args[0][0]).to.equal('/root/');
      expect(statSyncStub.args[0][0]).to.equal('/root/');
      expect(statSyncResultObj.isDirectory.calledOnce).to.be.true;
      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        flags: {},
        host: 'host.contentstack.io',
        projectBasePath: '/root/',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        config: '/root/.cs-launch.json',
        logsApiBaseUrl: 'https://configlaunch-baseurl.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://configlaunch-baseurl.csnonprod.com/launch-api/manage/graphql',
      });
    });

    it('should successfully initialize sharedConfig.manageApiBaseUrl and sharedConfig.logsApiBaseUrl if launchHubUrl is set', async () => {
      sandbox.stub(BaseCommand.prototype, 'launchHubUrl').value('https://this-launchHubUrl.csnonprod.com/launch-api');

      await baseCommandInstance.prepareConfig();

      expect(existsSyncStub.args[0][0]).to.equal('/root/');
      expect(statSyncStub.args[0][0]).to.equal('/root/');
      expect(statSyncResultObj.isDirectory.calledOnce).to.be.true;
      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        flags: {},
        host: 'host.contentstack.io',
        projectBasePath: '/root/',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        config: '/root/.cs-launch.json',
        logsApiBaseUrl: 'https://this-launchHubUrl.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://this-launchHubUrl.csnonprod.com/launch-api/manage/graphql',
      });
    });

    it('should successfully initialize sharedConfig.projectBasePath if "data-dir" flag is passed', async () => {
      const flags = {
        'data-dir': '/root/subdirectory/project1',
      };
      baseCommandInstance.flags = flags;

      await baseCommandInstance.prepareConfig();

      expect(existsSyncStub.args[0][0]).to.equal('/root/subdirectory/project1');
      expect(statSyncStub.args[0][0]).to.equal('/root/subdirectory/project1');
      expect(statSyncResultObj.isDirectory.calledOnce).to.be.true;
      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        flags,
        host: 'host.contentstack.io',
        'data-dir': '/root/subdirectory/project1',
        projectBasePath: '/root/subdirectory/project1',
        config: '/root/.cs-launch.json',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        logsApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/manage/graphql',
      });
    });

    it('should initialize sharedConfig.provider if "type" flag is passed', async () => {
      const flags = {
        'type': 'FILEUPLOAD',
      };
      baseCommandInstance.flags = flags;

      await baseCommandInstance.prepareConfig();

      expect(configHandlerGetStub.args[1][0]).to.equal('authtoken');
      expect(configHandlerGetStub.args[2][0]).to.equal('authorisationType');
      expect(configHandlerGetStub.args[3][0]).to.equal('oauthAccessToken');
      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        flags,
        type: 'FILEUPLOAD',
        provider: 'FILEUPLOAD',
        host: 'host.contentstack.io',
        projectBasePath: '/root/',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        config: '/root/.cs-launch.json',
        logsApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/manage/graphql',
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
      const flags = {
        config: '/root/subdirectory/configs/dev.json',
      };
      baseCommandInstance.flags = flags;
      existsSyncStub.withArgs('/root/subdirectory/configs/dev.json').returns(false);

      await baseCommandInstance.prepareConfig();

      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        config: '/root/subdirectory/configs/dev.json',
        flags,
        host: 'host.contentstack.io',
        projectBasePath: '/root/',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        config: '/root/subdirectory/configs/dev.json',
        logsApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/manage/graphql',
      });
    });

    it('should initialize sharedConfig.isExistingProject if config file exists', async () => {
      existsSyncStub.withArgs('/root/.cs-launch.json').returns(true);

      await baseCommandInstance.prepareConfig();

      expect(baseCommandInstance.sharedConfig).to.deep.equal({
        ...require('../../src/config').default,
        currentConfig: {},
        flags: {},
        host: 'host.contentstack.io',
        projectBasePath: '/root/',
        authtoken: 'testauthtoken',
        authType: 'testauthorisationType',
        authorization: 'testoauthAccessToken',
        config: '/root/.cs-launch.json',
        isExistingProject: true,
        logsApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/logs/graphql',
        manageApiBaseUrl: 'https://dev11-app.csnonprod.com/launch-api/manage/graphql',
      });
    });
  });
});
