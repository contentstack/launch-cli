import { UsageError } from './errors';
import { getManageApiBaseUrl, resolveLaunchHubUrl } from './region';

describe('getManageApiBaseUrl', () => {
  it('appends the manage API path to the launch hub url', () => {
    expect(getManageApiBaseUrl('https://launch-api.contentstack.com')).toBe(
      'https://launch-api.contentstack.com/manage',
    );
  });

  it('tolerates a trailing slash on the hub url', () => {
    expect(getManageApiBaseUrl('https://launch-api.contentstack.com/')).toBe(
      'https://launch-api.contentstack.com/manage',
    );
  });

  it.each([['//'], ['///']])('tolerates %s at the end of the hub url', (slashes) => {
    expect(getManageApiBaseUrl(`https://launch-api.contentstack.com${slashes}`)).toBe(
      'https://launch-api.contentstack.com/manage',
    );
  });
});

describe('resolveLaunchHubUrl', () => {
  it('uses the launch hub url the region declares', () => {
    expect(resolveLaunchHubUrl({ launchHubUrl: 'https://launch-api.contentstack.com' })).toBe(
      'https://launch-api.contentstack.com',
    );
  });

  it('derives the hub url from the cma host when the region declares no launch hub url', () => {
    expect(resolveLaunchHubUrl({ cma: 'api.contentstack.io' })).toBe('https://launch-api.contentstack.com');
  });

  it('strips the scheme from a cma url before deriving the hub url', () => {
    expect(resolveLaunchHubUrl({ cma: 'https://eu-api.contentstack.com' })).toBe(
      'https://eu-launch-api.contentstack.com',
    );
  });

  it('derives the hub url from a cma host that merely begins with http rather than crashing on it', () => {
    expect(resolveLaunchHubUrl({ cma: 'httpapi.example.test' })).toBe('https://httplaunch-api.example.test');
  });

  it('rewrites a trailing io to com, because the launch hub is only served on the com domain', () => {
    expect(resolveLaunchHubUrl({ cma: 'eu-api.contentstack.io' })).toBe('https://eu-launch-api.contentstack.com');
  });

  it('rewrites only a trailing io, leaving an io inside the host alone', () => {
    expect(resolveLaunchHubUrl({ cma: 'api.audio.io' })).toBe('https://launch-api.audio.com');
  });

  it('rewrites the host of a cma url that carries a path, leaving the path where it was', () => {
    expect(resolveLaunchHubUrl({ cma: 'https://api.contentstack.io/v3' })).toBe(
      'https://launch-api.contentstack.com/v3',
    );
  });

  it.each([['api.studio.io.example.com'], ['api.contentstackio'], ['api.iodine.com']])(
    'leaves %s alone because its host does not end in a dot io label',
    (cma) => {
      expect(resolveLaunchHubUrl({ cma })).toBe(`https://${cma.replace('api', 'launch-api')}`);
    },
  );

  it('leaves a host that does not end in io alone', () => {
    expect(resolveLaunchHubUrl({ cma: 'api.csnonprod.com' })).toBe('https://launch-api.csnonprod.com');
  });

  it('rewrites a dev11 cma host to dev, which is where dev11 tokens are accepted', () => {
    expect(resolveLaunchHubUrl({ cma: 'dev11-api.csnonprod.com' })).toBe('https://dev-launch-api.csnonprod.com');
  });

  it('prefers the declared launch hub url over the cma host when both are present', () => {
    expect(resolveLaunchHubUrl({ launchHubUrl: 'https://custom-launch.example.com', cma: 'api.contentstack.io' })).toBe(
      'https://custom-launch.example.com',
    );
  });

  it('throws a usage error naming the region command when the region has neither', () => {
    expect(() => resolveLaunchHubUrl({})).toThrow(UsageError);
    expect(() => resolveLaunchHubUrl({})).toThrow(
      'Region not configured. Please set the region with command $ csdx config:set:region',
    );
  });

  it('throws a usage error when no region is configured at all', () => {
    expect(() => resolveLaunchHubUrl(undefined)).toThrow(UsageError);
    expect(() => resolveLaunchHubUrl(undefined)).toThrow(
      'Region not configured. Please set the region with command $ csdx config:set:region',
    );
  });
});
