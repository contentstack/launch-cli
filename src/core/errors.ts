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

export class MissingInputError extends UsageError {
  readonly flag: string;

  constructor(flag: string) {
    super(
      `Missing required value for --${flag}. Pass --${flag}, set it in ${PROJECT_CONFIG_FILE}, ` +
        'or run in an interactive terminal.',
    );
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
