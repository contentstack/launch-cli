import { gitConnectionLines } from './git.presenter';

const CONNECT_URL = 'https://dev11-app.csnonprod.com/#!/launch/settings/connected-accounts';

describe('gitConnectionLines', () => {
  it('names the problem, the way out and the url, in the order V1 printed them', () => {
    expect(gitConnectionLines('GitHub', CONNECT_URL, false)).toEqual([
      'error: GitHub connection not found!',
      'info: You can connect your GitHub account to the UI using the following URL:',
      CONNECT_URL,
    ]);
  });

  it('colours the problem red and the way out green on a terminal, as winston did for V1', () => {
    expect(gitConnectionLines('GitHub', CONNECT_URL, true)).toEqual([
      '\u001b[31merror: GitHub connection not found!\u001b[39m',
      '\u001b[32minfo: You can connect your GitHub account to the UI using the following URL:\u001b[39m',
      `\u001b[32m${CONNECT_URL}\u001b[39m`,
    ]);
  });

  it('says only what it knows when there is no url to offer', () => {
    expect(gitConnectionLines('GitHub', undefined, false)).toEqual(['error: GitHub connection not found!']);
  });
});
