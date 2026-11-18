import { loadOpen, openInBrowser } from './browser';

const URL = 'https://app.contentstack.com';

function loaderOf(open: jest.Mock) {
  return jest.fn(async () => ({ default: open }));
}

describe('loadOpen', () => {
  it('loads the ESM-only open package at runtime', async () => {
    const { default: open } = await loadOpen();

    expect(typeof open).toBe('function');
  });
});

describe('openInBrowser', () => {
  it('hands the url to the open it loads lazily', async () => {
    const open = jest.fn().mockResolvedValue(undefined);

    await openInBrowser(URL, loaderOf(open));

    expect(open).toHaveBeenCalledWith(URL);
  });

  it('swallows a browser that will not open, because the message it accompanies still has to be read', async () => {
    const open = jest.fn().mockRejectedValue(new Error('no handler'));

    await expect(openInBrowser(URL, loaderOf(open))).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(URL);
  });

  it('swallows a browser that throws outright rather than rejecting', async () => {
    const open = jest.fn(() => {
      throw new Error('spawn failed');
    });

    await expect(openInBrowser(URL, loaderOf(open))).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(URL);
  });

  it('swallows an open module that cannot be loaded', async () => {
    const load = jest.fn().mockRejectedValue(new Error('ERR_REQUIRE_ESM'));

    await expect(openInBrowser(URL, load)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalled();
  });
});
