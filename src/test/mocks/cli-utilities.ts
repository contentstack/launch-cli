import { Args, Command, Errors, Flags, Interfaces } from '@oclif/core';

class CLIError extends Error {}

export const launchCommand = {
  Args,
  Command,
  Errors,
  Flags,
  Interfaces,
  CLIError,
  cliux: {
    inquire: jest.fn(),
    print: jest.fn(),
    loader: jest.fn(),
    registerSearchPlugin: jest.fn(),
  },
  configHandler: { get: jest.fn() },
  authHandler: {
    compareOAuthExpiry: jest.fn().mockResolvedValue(undefined),
    host: '',
  },
  HttpClient: jest.fn(),
  ContentstackClient: jest.fn(),
  isAuthenticated: jest.fn().mockReturnValue(true),
  managementSDKClient: jest.fn(),
  managementSDKInitiator: jest.fn(),
};

export const fileUploadAdapter = {
  cliux: {
    inquire: jest.fn(),
    loader: jest.fn(),
    print: jest.fn(),
    registerSearchPlugin: jest.fn(),
    confirm: jest.fn(),
    prompt: jest.fn(),
    styledJSON: jest.fn(),
    table: jest.fn(),
  },
  configHandler: { get: jest.fn() },
  HttpClient: jest.fn(),
  ContentstackClient: jest.fn(),
  authHandler: {
    compareOAuthExpiry: jest.fn().mockResolvedValue(undefined),
    host: '',
  },
};

export const githubAdapter = {
  cliux: {
    inquire: jest.fn(),
    print: jest.fn(),
    loader: jest.fn(),
    registerSearchPlugin: jest.fn(),
    confirm: jest.fn(),
    prompt: jest.fn(),
    styledJSON: jest.fn(),
    table: jest.fn(),
  },
  configHandler: { get: jest.fn() },
  ContentstackClient: jest.fn(),
  authHandler: {
    compareOAuthExpiry: jest.fn().mockResolvedValue(undefined),
    host: '',
  },
};

export const baseClassAdapter = {
  cliux: {
    inquire: jest.fn(),
    table: jest.fn(),
    print: jest.fn(),
    loader: jest.fn(),
    registerSearchPlugin: jest.fn(),
    confirm: jest.fn(),
    prompt: jest.fn(),
    styledJSON: jest.fn(),
  },
  ContentstackClient: jest.fn(),
  configHandler: { get: jest.fn() },
  authHandler: {
    compareOAuthExpiry: jest.fn().mockResolvedValue(undefined),
    host: '',
  },
};

export const functionsCommand = {};

export const logPolling = {
  cliux: {
    loaderV2: jest.fn(() => ({})),
  },
};
