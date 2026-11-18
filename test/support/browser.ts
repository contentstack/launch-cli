import type * as Browser from '../../src/core/browser';

const actual = jest.requireActual<typeof Browser>('../../src/core/browser');

export function openInBrowser(url: string): Promise<void> {
  return actual.openInBrowser(url, async () => ({ default: jest.requireMock('open') }));
}
