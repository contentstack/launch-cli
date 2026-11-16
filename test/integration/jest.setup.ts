jest.mock('../../src/util/open-url', () => ({
  openUrl: jest.fn(async () => undefined),
}));

jest.mock(`${process.cwd()}/node_modules/@oclif/core/lib/util/os.js`, () => ({
  ...jest.requireActual(`${process.cwd()}/node_modules/@oclif/core/lib/util/os.js`),
  getPlatform: async () => require('node:os').platform(),
}));

jest.mock('@contentstack/cli-utilities/lib/contentstack-management-sdk', () => ({
  __esModule: true,
  default: async () => require('./harness/cma').cma.client(),
  managementSDKInitiator: { init: () => undefined },
}));

jest.setTimeout(30_000);
