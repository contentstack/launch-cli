import { openUrl } from './open-url';

describe('openUrl', () => {
  it('resolves instead of rejecting when the browser cannot be opened', async () => {
    // Jest's VM cannot run the native import(), so this exercises the failure path.
    await expect(openUrl('https://example.com')).resolves.toBeUndefined();
  });
});
