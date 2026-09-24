import { CloudFunctionsValidator } from './cloud-functions-validator';
import { CloudFunctionResource } from './types';

import './types';

function resourcesFor(...apiResourceURIs: string[]): CloudFunctionResource[] {
  return apiResourceURIs.map((apiResourceURI) => ({
    apiResourceURI,
    cloudFunctionFilePath: `/project/functions${apiResourceURI}.js`,
    handler: () => undefined,
  }));
}

describe('CloudFunctionsValidator', () => {
  it('accepts an empty resource list', () => {
    expect(new CloudFunctionsValidator([]).validate()).toBeUndefined();
  });

  it('accepts exact routes, nested routes and distinct dynamic routes', () => {
    const validator = new CloudFunctionsValidator(
      resourcesFor('/users', '/api/nested/deep-route', '/api/[id]', '/api/[id]/comments/[commentId]', '/api/under_score'),
    );

    expect(validator.validate()).toBeUndefined();
  });

  it('rejects a top level dynamic route', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/[id]')).validate();

    expect(error).toBeInstanceOf(Error);
    expect(error?.name).toBe('TopLevelDynamicRouteError');
    expect(error?.message).toContain('/[id] -> /api/[id]');
  });

  it('rejects a top level dynamic route that has a nested remainder', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/[id]/details')).validate();

    expect(error?.name).toBe('TopLevelDynamicRouteError');
  });

  it('rejects a filepath with characters outside the allowed set', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/api/we!rd')).validate();

    expect(error?.name).toBe('InvalidFilepathNamingError');
    expect(error?.message).toContain('Rename: /api/we!rd.');
  });

  it('rejects a dynamic route name holding a disallowed character', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/api/[id.value]')).validate();

    expect(error?.name).toBe('InvalidFilepathNamingError');
  });

  it('rejects repeated dynamic route names within one path', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/api/[id]/nested/[id]')).validate();

    expect(error?.name).toBe('IndistinctDynamicRouteNamesInPathError');
    expect(error?.message).toContain('/api/[id]/nested/[id]');
  });

  it('rejects a second dynamic route at the level an earlier one already claimed', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/api/[id]', '/api/[slug]')).validate();

    expect(error?.name).toBe('ExistingDynamicRouteAtSameLevelError');
    expect(error?.message).toBe('The path \'/api/[slug]\' conflicts with \'/api/[id]\' on the same hierarchical level.');
  });

  it('accepts dynamic routes that sit at different levels', () => {
    const validator = new CloudFunctionsValidator(resourcesFor('/api/[id]', '/api/nested/[slug]'));

    expect(validator.validate()).toBeUndefined();
  });

  it('reports the first failing resource and stops', () => {
    const error = new CloudFunctionsValidator(resourcesFor('/ok', '/[id]', '/api/we!rd')).validate();

    expect(error?.name).toBe('TopLevelDynamicRouteError');
  });

  it('rejects a long filepath with a disallowed character in bounded time', () => {
    const longName = 'a'.repeat(40);
    const started = Date.now();

    const error = new CloudFunctionsValidator(resourcesFor(`/${longName}!`)).validate();

    expect(Date.now() - started).toBeLessThan(1000);
    expect(error?.name).toBe('InvalidFilepathNamingError');
    expect(error?.message).toContain(`Rename: /${longName}!.`);
  });

  it('rejects a long dynamic route name with a disallowed character in bounded time', () => {
    const longName = 'a'.repeat(40);
    const started = Date.now();

    const error = new CloudFunctionsValidator(resourcesFor(`/api/[${longName}.value]`)).validate();

    expect(Date.now() - started).toBeLessThan(1000);
    expect(error?.name).toBe('InvalidFilepathNamingError');
  });

  it('accepts a long word run, a bracket group and a trailing word run in one segment', () => {
    const validator = new CloudFunctionsValidator(resourcesFor(`/api/${'a'.repeat(40)}[id]tail`));

    expect(validator.validate()).toBeUndefined();
  });

  it('rejects an empty api resource uri', () => {
    const error = new CloudFunctionsValidator(resourcesFor('')).validate();

    expect(error?.name).toBe('InvalidFilepathNamingError');
  });
});
