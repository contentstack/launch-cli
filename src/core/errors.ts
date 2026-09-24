import { EXIT_CANCELLED, EXIT_RUNTIME, EXIT_USAGE, PROJECT_CONFIG_FILE } from './constants';

export type ExitCode = typeof EXIT_RUNTIME | typeof EXIT_USAGE | typeof EXIT_CANCELLED;

export abstract class LaunchError extends Error {
  abstract readonly exitCode: ExitCode;
}

export class UsageError extends LaunchError {
  readonly exitCode = EXIT_USAGE;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export class CancelledError extends LaunchError {
  readonly exitCode = EXIT_CANCELLED;

  constructor() {
    super('Cancelled. Nothing was changed.');
    this.name = 'CancelledError';
  }
}

export class UnauthenticatedError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor() {
    super('This session carries no Contentstack authorisation type. Run csdx auth:login to continue.');
    this.name = 'UnauthenticatedError';
  }
}

export class SessionExpiredError extends LaunchError {
  readonly exitCode = EXIT_RUNTIME;

  constructor() {
    super('Your session has timed out. Run csdx auth:login to continue.');
    this.name = 'SessionExpiredError';
  }
}

export interface InputRemedies {
  config: boolean;
  prompt: boolean;
}

function advice(flag: string, remedies: InputRemedies): string {
  const steps = [`Pass --${flag}`];

  if (remedies.config) {
    steps.push(`set it in ${PROJECT_CONFIG_FILE}`);
  }

  if (remedies.prompt) {
    steps.push('run in an interactive terminal');
  }

  if (steps.length < 3) {
    return `${steps.join(' or ')}.`;
  }

  return `${steps.slice(0, -1).join(', ')}, or ${steps[steps.length - 1]}.`;
}

export class MissingInputError extends UsageError {
  readonly flag: string;

  constructor(flag: string, remedies: InputRemedies) {
    super(`Missing required value for --${flag}. ${advice(flag, remedies)}`);
    this.name = 'MissingInputError';
    this.flag = flag;
  }
}

export class InputDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputDependencyError';
  }
}
