import open from 'open';

import { openInBrowser } from './browser';

jest.mock('open', () => jest.fn());

describe('openInBrowser', () => {
  beforeEach(() => {
    (open as unknown as jest.Mock).mockReset();
  });

  it('hands the url to the platform browser', () => {
    (open as unknown as jest.Mock).mockResolvedValue(undefined);

    openInBrowser('https://dev11-app.csnonprod.com/#!/launch/settings/connected-accounts');

    expect(open).toHaveBeenCalledWith('https://dev11-app.csnonprod.com/#!/launch/settings/connected-accounts');
  });

  it('swallows a browser that will not open, because the message it accompanies still has to be read', async () => {
    (open as unknown as jest.Mock).mockRejectedValue(new Error('no handler'));

    expect(() => openInBrowser('https://app.contentstack.com')).not.toThrow();

    await Promise.resolve();
  });

  it('swallows a browser that throws outright rather than rejecting', () => {
    (open as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('spawn failed');
    });

    expect(() => openInBrowser('https://app.contentstack.com')).not.toThrow();
  });
});
