import { getManageApiBaseUrl } from './region';

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
});
