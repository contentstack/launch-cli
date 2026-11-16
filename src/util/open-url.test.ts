import { openUrl } from './open-url';

describe('openUrl', () => {
  it('opens the URL with the loaded open package', async () => {
    const open = jest.fn(async () => undefined);

    await openUrl('https://example.com', async () => ({ default: open }));

    expect(open).toHaveBeenCalledWith('https://example.com');
  });

  it('resolves when the open package cannot be loaded', async () => {
    await expect(
      openUrl('https://example.com', async () => {
        throw new Error('load failed');
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves when opening the browser fails', async () => {
    const open = jest.fn(async () => {
      throw new Error('spawn failed');
    });

    await expect(openUrl('https://example.com', async () => ({ default: open }))).resolves.toBeUndefined();
  });
});
