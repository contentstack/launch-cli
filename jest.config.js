/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  restoreMocks: true,
  testMatch: ['**/src/**/*.test.ts', '**/test/integration/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/credential-guard.setup.ts', '<rootDir>/test/no-terminal.setup.ts'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/test/uuid-shim.js',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
  ],
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};

module.exports = config;
