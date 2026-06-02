import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { createSandbox, SinonSandbox } from 'sinon';
import { configHandler } from '@contentstack/cli-utilities';

import { getAnalyticsInfo } from '../../../src/util/common-utility';

describe('getAnalyticsInfo', () => {
  let sandbox: SinonSandbox;

  beforeEach(() => {
    sandbox = createSandbox();
    const getStub = sandbox.stub(configHandler, 'get');
    getStub.withArgs('clientId').returns('client-123');
    getStub.withArgs('sessionId').returns('session-456');
    getStub.withArgs('currentCommandId').returns('launch:deployments');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns the canonical context.analyticsInfo when it is a non-empty string', () => {
    const result = getAnalyticsInfo(
      { analyticsInfo: 'darwin-arm64;v22.0.0;2.0.0;abc;def;launch' },
      { platform: 'linux', arch: 'x64', version: '9.9.9' },
    );

    expect(result).to.equal('darwin-arm64;v22.0.0;2.0.0;abc;def;launch');
  });

  it('reconstructs the value from config and config store when context has no analyticsInfo', () => {
    const result = getAnalyticsInfo({}, { platform: 'darwin', arch: 'arm64', version: '2.0.0-beta.15' });

    expect(result).to.equal(
      `darwin-arm64;v${process.versions.node};2.0.0-beta.15;client-123;session-456;launch:deployments`,
    );
  });

  it('falls back to reconstruction when context.analyticsInfo is an empty string', () => {
    const result = getAnalyticsInfo({ analyticsInfo: '' }, { platform: 'darwin', arch: 'arm64', version: '2.0.0' });

    expect(result).to.equal(`darwin-arm64;v${process.versions.node};2.0.0;client-123;session-456;launch:deployments`);
  });

  it('uses safe defaults when config is missing but still reads the config store', () => {
    const result = getAnalyticsInfo(undefined, undefined);

    expect(result).to.equal(`none;v${process.versions.node};none;client-123;session-456;launch:deployments`);
  });

  it('defaults the command segment to "launch" when currentCommandId is not set', () => {
    sandbox.restore();
    sandbox = createSandbox();
    const getStub = sandbox.stub(configHandler, 'get');
    getStub.withArgs('clientId').returns('client-123');
    getStub.withArgs('sessionId').returns('session-456');
    getStub.withArgs('currentCommandId').returns(undefined);

    const result = getAnalyticsInfo({}, { platform: 'darwin', arch: 'arm64', version: '2.0.0' });

    expect(result).to.equal(`darwin-arm64;v${process.versions.node};2.0.0;client-123;session-456;launch`);
  });
});
