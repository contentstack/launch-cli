import { gitConnectionLines, namespaceNotConnectedLines, repositoryLabel } from './git.presenter';

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

describe('namespaceNotConnectedLines', () => {
  it('names the accounts the user has and the one that owns the repository', () => {
    expect(namespaceNotConnectedLines('SakshiKoli-CS', ['harshi-xyz'], CONNECT_URL, false)).toEqual([
      'error: You are connected to GitHub as "harshi-xyz", which does not own this repository.',
      `info: This repository belongs to "SakshiKoli-CS". Manage your GitHub connections: ${CONNECT_URL}`,
    ]);
  });

  it('agrees with the verb when several accounts are connected', () => {
    expect(namespaceNotConnectedLines('SakshiKoli-CS', ['harshi-xyz', 'acme-org'], undefined, false)[0]).toBe(
      'error: You are connected to GitHub as "harshi-xyz" and "acme-org", which do not own this repository.',
    );
  });

  it('lists three accounts without a comma before the last', () => {
    expect(namespaceNotConnectedLines('owner', ['a', 'b', 'c'], undefined, false)[0]).toBe(
      'error: You are connected to GitHub as "a", "b" and "c", which do not own this repository.',
    );
  });

  it('leaves the url out of the way-out line when there is none to offer', () => {
    expect(namespaceNotConnectedLines('owner', ['a'], undefined, false)[1]).toBe(
      'info: This repository belongs to "owner".',
    );
  });

  it('colours the problem red and the way out green on a terminal', () => {
    expect(namespaceNotConnectedLines('owner', ['a'], undefined, true)).toEqual([
      '\u001b[31merror: You are connected to GitHub as "a", which does not own this repository.\u001b[39m',
      '\u001b[32minfo: This repository belongs to "owner".\u001b[39m',
    ]);
  });
});

describe('repositoryLabel', () => {
  it('labels a repository by its full name, falling back to its bare name', () => {
    expect(repositoryLabel({ fullName: 'my-org/my-repo', name: 'my-repo' })).toBe('my-org/my-repo');
    expect(repositoryLabel({ name: 'my-repo' })).toBe('my-repo');
    expect(repositoryLabel({})).toBe('');
  });
});
