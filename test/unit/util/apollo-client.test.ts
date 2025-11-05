//@ts-nocheck
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { createSandbox } from 'sinon';

describe('Apollo Client Console Suppression', () => {
  let sandbox;
  let originalEnv;
  let originalError;
  let originalWarn;
  let modulePath;

  beforeEach(() => {
    sandbox = createSandbox();
    originalEnv = process.env.NODE_ENV;
    originalError = console.error;
    originalWarn = console.warn;
    modulePath = require.resolve('../../../src/util/apollo-client');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    console.error = originalError;
    console.warn = originalWarn;
    sandbox.restore();
    
    if (require.cache[modulePath]) {
      delete require.cache[modulePath];
    }
  });

  it('should show errors/warnings when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development';
    
    const errorSpy = sandbox.spy();
    const warnSpy = sandbox.spy();
    
    delete require.cache[modulePath];
    
    console.error = errorSpy;
    console.warn = warnSpy;
    
    const apolloClientModule = require('../../../src/util/apollo-client');
    
    expect(apolloClientModule.isNotDevelopment).to.be.false;

    const apolloErrorMsg = 'Error: go.apollo.dev/c/err/test';
    const apolloWarnMsg = 'Warning: cache.diff issue';
    const regularErrorMsg = 'Regular error message';
    const regularWarnMsg = 'Regular warning message';

    console.error(apolloErrorMsg);
    console.warn(apolloWarnMsg);
    console.error(regularErrorMsg);
    console.warn(regularWarnMsg);

    expect(errorSpy.callCount).to.equal(2);
    expect(warnSpy.callCount).to.equal(2);
    expect(errorSpy.calledWith(apolloErrorMsg)).to.be.true;
    expect(errorSpy.calledWith(regularErrorMsg)).to.be.true;
    expect(warnSpy.calledWith(apolloWarnMsg)).to.be.true;
    expect(warnSpy.calledWith(regularWarnMsg)).to.be.true;
  });

  it('should suppress Apollo errors/warnings when NODE_ENV is not development', () => {
    process.env.NODE_ENV = 'isNotDevelopment';
    
    const originalErrorBefore = console.error;
    const originalWarnBefore = console.warn;
    
    const errorSpy = sandbox.spy(originalErrorBefore);
    const warnSpy = sandbox.spy(originalWarnBefore);
    
    console.error = errorSpy;
    console.warn = warnSpy;
    
    delete require.cache[modulePath];
    
    const apolloClientModule = require('../../../src/util/apollo-client');
    
    expect(apolloClientModule.isNotDevelopment).to.be.true;
    expect(console.error).to.not.equal(errorSpy);
    expect(console.warn).to.not.equal(warnSpy);

    const apolloErrorMsg = 'Error: go.apollo.dev/c/err/test';
    const apolloWarnMsg = 'Warning: cache.diff issue';
    const apolloCanonizeMsg = 'Warning: canonizeResults deprecated';
    const regularErrorMsg = 'Regular error message';
    const regularWarnMsg = 'Regular warning message';

    console.error(apolloErrorMsg);
    console.warn(apolloWarnMsg);
    console.warn(apolloCanonizeMsg);
    console.error(regularErrorMsg);
    console.warn(regularWarnMsg);

    const errorCalls = errorSpy.getCalls();
    const warnCalls = warnSpy.getCalls();
    
    const regularErrorLogged = errorCalls.some((call) => 
      call.args[0] === regularErrorMsg || call.args[0]?.toString() === regularErrorMsg
    );
    const regularWarnLogged = warnCalls.some((call) => 
      call.args[0] === regularWarnMsg || call.args[0]?.toString() === regularWarnMsg
    );
    
    expect(regularErrorLogged).to.be.true;
    expect(regularWarnLogged).to.be.true;
    
    const apolloErrorLogged = errorCalls.some((call) => 
      call.args[0]?.toString().includes('go.apollo.dev/c/err')
    );
    const apolloWarnLogged = warnCalls.some((call) => 
      call.args[0]?.toString().includes('cache.diff') || 
      call.args[0]?.toString().includes('canonizeResults')
    );
    
    expect(apolloErrorLogged).to.be.false;
    expect(apolloWarnLogged).to.be.false;
  });
});
