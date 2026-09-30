import { UsageError } from './errors';
import {
  connectedAccountsUrl,
  getLogsApiBaseUrl,
  getManageApiBaseUrl,
  resolveLaunchAppUrl,
  resolveLaunchHubUrl,
} from './region';

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

describe('getLogsApiBaseUrl', () => {
  it.each([[''], ['/'], ['//']])('appends the logs API path to the launch hub url ending in %j', (slashes) => {
    expect(getLogsApiBaseUrl(`https://launch-api.contentstack.com${slashes}`)).toBe(
      'https://launch-api.contentstack.com/logs',
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

describe('resolveLaunchAppUrl', () => {
  it('takes the app url the region names, because uiHost is the Contentstack app itself', () => {
    expect(resolveLaunchAppUrl({ cma: 'dev11-api.csnonprod.io', uiHost: 'https://dev11-app.csnonprod.com' })).toBe(
      'https://dev11-app.csnonprod.com',
    );
  });

  it('gives a bare uiHost a scheme, so the url is one a browser can open', () => {
    expect(resolveLaunchAppUrl({ uiHost: 'app.contentstack.com' })).toBe('https://app.contentstack.com');
  });

  it.each<[string, string]>([
    ['dev11-api.csnonprod.io', 'https://dev11-app.csnonprod.com'],
    ['api.contentstack.io', 'https://app.contentstack.com'],
    ['https://eu-api.contentstack.com', 'https://eu-app.contentstack.com'],
    ['azure-na-api.contentstack.com', 'https://azure-na-app.contentstack.com'],
  ])('falls back to deriving the app url from the cma host %s when the region names no uiHost', (cma, expected) => {
    expect(resolveLaunchAppUrl({ cma })).toBe(expected);
  });

  it('keeps the dev11 prefix, because the app is served there while the api is not', () => {
    expect(resolveLaunchAppUrl({ cma: 'dev11-api.csnonprod.io' })).toContain('dev11-app');
  });

  it.each<[string, string]>([
    ['rapid-api.example.test', 'https://rapid-app.example.test'],
    ['api.rapid.example.test', 'https://app.rapid.example.test'],
  ])('reads api only in the leading label of %s, so the rest of the host is not mangled', (cma, expected) => {
    expect(resolveLaunchAppUrl({ cma })).toBe(expected);
  });

  it.each([[undefined], [{}], [{ launchHubUrl: 'https://launch-api.contentstack.com' }]])(
    'answers undefined rather than guessing an app url from %j',
    (region) => {
      expect(resolveLaunchAppUrl(region)).toBeUndefined();
    },
  );

  it.each([['cma.example.test'], ['launch.example.test'], ['cma.example.test/branch']])(
    'answers undefined for the cma host %s, which names no app host to derive one from',
    (cma) => {
      expect(resolveLaunchAppUrl({ cma })).toBeUndefined();
    },
  );
});

describe('connectedAccountsUrl', () => {
  it.each([[''], ['/'], ['//']])('points at the connected accounts page of an app url ending in %j', (slashes) => {
    expect(connectedAccountsUrl(`https://dev11-app.csnonprod.com${slashes}`)).toBe(
      'https://dev11-app.csnonprod.com/#!/launch/settings/connected-accounts',
    );
  });
});
