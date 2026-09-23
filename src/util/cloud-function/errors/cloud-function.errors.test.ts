import {
  ExistingDynamicRouteAtSameLevelError,
  FunctionsDirectoryNotFoundError,
  IndistinctDynamicRouteNamesInPathError,
  InvalidFilepathNamingError,
  TopLevelDynamicRouteError,
} from './cloud-function.errors';

describe('cloud function errors', () => {
  it('names and describes a top level dynamic route', () => {
    const error = new TopLevelDynamicRouteError('/[id]');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TopLevelDynamicRouteError');
    expect(error.message).toBe(
      'Top level dynamic route keys are not supported. Please move them to a sub directory Example: /[id] -> /api/[id]',
    );
  });

  it('names and describes an invalid filepath naming', () => {
    const error = new InvalidFilepathNamingError('/api/we!rd');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidFilepathNamingError');
    expect(error.message).toBe(
      'Rename: /api/we!rd. Only alphanumeric characters, hyphens, underscores and [param] should be used in the naming of function and its parent directory.',
    );
  });

  it('names and describes indistinct dynamic route names', () => {
    const error = new IndistinctDynamicRouteNamesInPathError('/api/[id]/[id]');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('IndistinctDynamicRouteNamesInPathError');
    expect(error.message).toBe('Error while parsing: /api/[id]/[id]. Param keys should be unique within a function path.');
  });

  it('names and describes a conflicting dynamic route at the same level', () => {
    const error = new ExistingDynamicRouteAtSameLevelError('/api/[slug]', '/api/[id]');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ExistingDynamicRouteAtSameLevelError');
    expect(error.message).toBe('The path \'/api/[slug]\' conflicts with \'/api/[id]\' on the same hierarchical level.');
  });

  it('names and describes a missing functions directory', () => {
    const error = new FunctionsDirectoryNotFoundError('/tmp/project');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FunctionsDirectoryNotFound');
    expect(error.message).toBe('No functions directory found at \'/tmp/project\'.');
  });

  it('keeps an empty filepath in the rendered message', () => {
    expect(new TopLevelDynamicRouteError('').message).toBe(
      'Top level dynamic route keys are not supported. Please move them to a sub directory Example:  -> /api',
    );
    expect(new FunctionsDirectoryNotFoundError('').message).toBe('No functions directory found at \'\'.');
  });
});
