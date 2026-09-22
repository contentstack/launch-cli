const config = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/specs/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/integration/tsconfig.json' }],
    '^.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2020', esModuleInterop: true } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  globalSetup: '<rootDir>/test/integration/jest.global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/jest.global-teardown.ts',
  setupFiles: ['<rootDir>/test/integration/jest.setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/integration/jest.setup.ts'],
  maxWorkers: 1,
  testTimeout: 30000,
  forceExit: true,
  coverageDirectory: 'coverage/integration',
  coverageProvider: 'v8',
  collectCoverageFrom: ['src/**/*.ts', '!src/test/**', '!src/**/*.test.ts'],
};

module.exports = config;
