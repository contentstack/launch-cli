import { openUrl } from './open-url';

describe('openUrl', () => {
  it('opens the URL with the loaded open package', async () => {
    const open = jest.fn(async () => undefined);

    await openUrl('https://example.com', async () => ({ default: open }));

    expect(open).toHaveBeenCalledWith('https://example.com');
  });

  it('resolves when the open package cannot be loaded', async () => {
    const load = jest.fn(async () => {
      throw new Error('load failed');
    });

    await expect(openUrl('https://example.com', load)).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('resolves when opening the browser fails', async () => {
    const open = jest.fn(async () => {
      throw new Error('spawn failed');
    });

    await expect(openUrl('https://example.com', async () => ({ default: open }))).resolves.toBeUndefined();

    expect(open).toHaveBeenCalledWith('https://example.com');
  });
});
