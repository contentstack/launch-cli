import { previewUrlOf, siteUrlOf } from './site.url';

describe('siteUrlOf', () => {
  it("chooses the deployment's own url over any domain", () => {
    const deployment = { uid: 'd1', deploymentUrl: 'https://my-site.contentstackapps.com' };

    const url = siteUrlOf(deployment, [{ url: 'https://www.example.com' }]);

    expect(url).toBe('https://my-site.contentstackapps.com');
  });

  it('falls back to the first domain that has a url when the deployment carries none, adding the scheme', () => {
    const deployment = { uid: 'd1', deploymentUrl: '', previewUrl: '' };

    const url = siteUrlOf(deployment, [{}, { url: '' }, { url: 'www.example.com' }, { url: 'b.example.com' }]);

    expect(url).toBe('https://www.example.com');
  });

  it('adds https:// to a deployment url without a scheme and leaves an http:// one alone', () => {
    const bare = siteUrlOf({ uid: 'd1', deploymentUrl: 'my-site.contentstackapps.com' });
    const plain = siteUrlOf({ uid: 'd1', deploymentUrl: 'http://my-site.example.test' });

    expect(bare).toBe('https://my-site.contentstackapps.com');
    expect(plain).toBe('http://my-site.example.test');
  });

  it('uses the preview url when the deployment has no deployment url, before any domain', () => {
    const url = siteUrlOf({ uid: 'd1', previewUrl: 'preview.example.test' }, [{ url: 'https://www.example.com' }]);

    expect(url).toBe('https://preview.example.test');
  });

  it('returns nothing without a deployment, even when the environment has domains', () => {
    const url = siteUrlOf(undefined, [{ url: 'https://production-sample-project.contentstackapps.com' }]);

    expect(url).toBeUndefined();
  });

  it.each([[undefined], [[]]])('returns nothing for a deployment with no url and domains %p', (domains) => {
    const url = siteUrlOf({ uid: 'd1', deploymentUrl: '' }, domains);

    expect(url).toBeUndefined();
  });

  it('returns nothing when no domain has a url either', () => {
    const url = siteUrlOf({ uid: 'd1' }, [{}, { url: '' }]);

    expect(url).toBeUndefined();
  });
});

describe('previewUrlOf', () => {
  it('reads the preview url alone, adding the scheme, and ignores the deployment url', () => {
    const bare = previewUrlOf({ uid: 'd1', deploymentUrl: 'https://my-site.contentstackapps.com', previewUrl: 'preview.example.test' });
    const plain = previewUrlOf({ uid: 'd1', previewUrl: 'http://preview.example.test' });

    expect(bare).toBe('https://preview.example.test');
    expect(plain).toBe('http://preview.example.test');
  });

  it.each([[undefined], [''], ['   ']])('returns nothing for a preview url of %p even with a deployment url', (previewUrl) => {
    const url = previewUrlOf({ uid: 'd1', deploymentUrl: 'https://my-site.contentstackapps.com', previewUrl });

    expect(url).toBeUndefined();
  });
});
