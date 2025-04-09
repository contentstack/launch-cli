/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

/** @type {import('jest').Config} */
const config = {
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: 'v8',

  // A preset that is used as a base for Jest's configuration
  preset: 'ts-jest',

  // The glob patterns Jest uses to detect test files
  testMatch: ['**/src/**/?(*.)+(spec|test).[tj]s?(x)'],
};

module.exports = config;
