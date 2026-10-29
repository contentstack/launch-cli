jest.mock('open', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ pid: 1 })),
}));

jest.mock('@contentstack/cli-utilities/lib/contentstack-management-sdk', () => ({
  __esModule: true,
  default: async () => require('./harness/cma').cma.client(),
  managementSDKInitiator: { init: () => undefined },
}));

jest.setTimeout(30_000);
