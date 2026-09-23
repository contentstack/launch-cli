import { EXIT_CANCELLED, EXIT_RUNTIME, EXIT_USAGE, PROJECT_CONFIG_FILE } from './constants';
import {
  CancelledError,
  InputDependencyError,
  LaunchError,
  MissingInputError,
  UnauthenticatedError,
  UsageError,
} from './errors';

describe('UsageError', () => {
  it('is a LaunchError carrying the caller message, its own name and the usage exit code', () => {
    const error = new UsageError('Pass --org.');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LaunchError);
    expect(error.name).toBe('UsageError');
    expect(error.message).toBe('Pass --org.');
    expect(error.exitCode).toBe(EXIT_USAGE);
  });
});

describe('CancelledError', () => {
  it('carries a fixed message stating nothing was changed and the cancelled exit code', () => {
    const error = new CancelledError();

    expect(error).toBeInstanceOf(LaunchError);
    expect(error).not.toBeInstanceOf(UsageError);
    expect(error.name).toBe('CancelledError');
    expect(error.message).toBe('Cancelled. Nothing was changed.');
    expect(error.exitCode).toBe(EXIT_CANCELLED);
  });
});

describe('UnauthenticatedError', () => {
  it('is a runtime failure, not a usage failure', () => {
    const error = new UnauthenticatedError();

    expect(error).toBeInstanceOf(LaunchError);
    expect(error).not.toBeInstanceOf(UsageError);
    expect(error.name).toBe('UnauthenticatedError');
    expect(error.message).toBe('This session carries no Contentstack authorisation type. Run csdx auth:login to continue.');
    expect(error.exitCode).toBe(EXIT_RUNTIME);
  });
});

describe('MissingInputError', () => {
  it('names the flag, points at the three sources and inherits the usage exit code', () => {
    const error = new MissingInputError('org');

    expect(error).toBeInstanceOf(UsageError);
    expect(error).toBeInstanceOf(LaunchError);
    expect(error.name).toBe('MissingInputError');
    expect(error.flag).toBe('org');
    expect(error.exitCode).toBe(EXIT_USAGE);
    expect(error.message).toBe(
      `Missing required value for --org. Pass --org, set it in ${PROJECT_CONFIG_FILE}, or run in an interactive terminal.`,
    );
  });
});

describe('InputDependencyError', () => {
  it('stays a plain Error, because a command declaring the wrong inputs is a programming fault', () => {
    const error = new InputDependencyError('--project -> --org is a dependency cycle.');

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LaunchError);
    expect(error.name).toBe('InputDependencyError');
    expect(error.message).toBe('--project -> --org is a dependency cycle.');
  });
});
