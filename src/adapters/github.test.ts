import GitHub from './github';
import { getRemoteUrls } from '../util/create-git-meta';
import { repositoriesQuery, userConnectionsQuery } from '../graphql';
import BaseClass from './base-class';
import { existsSync } from 'fs';

jest.mock('../util/create-git-meta');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

const userConnections = [
  {
    __typename: 'UserConnection',
    userUid: 'testuser1',
    provider: 'GitHub',
  },
];
const repositories = [
  {
    __typename: 'GitRepository',
    id: '495370701',
    url: 'https://github.com/test-user/nextjs-ssr-isr-demo',
    name: 'nextjs-ssr-isr-demo',
    fullName: 'test-user/nextjs-ssr-isr-demo',
    defaultBranch: 'main',
  },
  {
    __typename: 'GitRepository',
    id: '555341263',
    url: 'https://github.com/test-user/static-site-demo',
    name: 'static-site-demo',
    fullName: 'test-user/static-site-demo',
    defaultBranch: 'main',
  },
  {
    __typename: 'GitRepository',
    id: '647250661',
    url: 'https://github.com/test-user/eleventy-sample',
    name: 'eleventy-sample',
    fullName: 'test-user/eleventy-sample',
    defaultBranch: 'main',
  },
];

describe('GitHub Adapter', () => {
  let logMock: jest.Mock;
  let exitMock: jest.Mock;

  beforeEach(() => {
    logMock = jest.fn();
    exitMock = jest.fn().mockImplementationOnce(() => {
      throw new Error('1');
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('checkGitHubConnected', () => {
    it('should return true if GitHub is connected', async () => {
      const userConnectionResponse = { data: { userConnections } };
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(userConnectionResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1', provider: 'GitHub' },
        apolloClient: apolloClient,
        log: logMock,
      } as any);
      const connectToAdapterOnUiMock = jest
        .spyOn(BaseClass.prototype, 'connectToAdapterOnUi')
        .mockResolvedValueOnce(undefined);

      await githubAdapterInstance.checkGitHubConnected();

      expect(apolloClient.query).toHaveBeenCalledWith({ query: userConnectionsQuery });
      expect(logMock).toHaveBeenCalledWith('GitHub connection identified!', 'info');
      expect(githubAdapterInstance.config.userConnection).toEqual(userConnections[0]);
      expect(connectToAdapterOnUiMock).not.toHaveBeenCalled();
    });

    it('should log an error and exit if GitHub is not connected', async () => {
      const userConnectionResponse = { data: { userConnections: [] } };
      const connectToAdapterOnUiMock = jest.spyOn(BaseClass.prototype, 'connectToAdapterOnUi').mockResolvedValueOnce();
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(userConnectionResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        apolloClient: apolloClient,
        log: logMock,
      } as any);

      await githubAdapterInstance.checkGitHubConnected();

      expect(apolloClient.query).toHaveBeenCalledWith({ query: userConnectionsQuery });
      expect(logMock).toHaveBeenCalledWith('GitHub connection not found!', 'error');
      expect(connectToAdapterOnUiMock).toHaveBeenCalled();
      expect(githubAdapterInstance.config.userConnection).toEqual(undefined);
    });
  });

  describe('checkGitRemoteAvailableAndValid', () => {
    const repositoriesResponse = { data: { repositories } };

    it(`should successfully check if the git remote is available and valid
       when the github remote URL is HTTPS based`, async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/eleventy-sample.git',
      });
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(repositoriesResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        apolloClient: apolloClient,
      } as any);

      const result = await githubAdapterInstance.checkGitRemoteAvailableAndValid();

      expect(existsSync).toHaveBeenCalledWith('/home/project1/.git');
      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(apolloClient.query).toHaveBeenCalledWith({ query: repositoriesQuery });
      expect(githubAdapterInstance.config.repository).toEqual({
        __typename: 'GitRepository',
        id: '647250661',
        url: 'https://github.com/test-user/eleventy-sample',
        name: 'eleventy-sample',
        fullName: 'test-user/eleventy-sample',
        defaultBranch: 'main',
      });
      expect(result).toBe(true);
    });

    it(`should successfully check if the git remote is available and valid
      when the github remote URL is SSH based`, async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'git@github.com:test-user/eleventy-sample.git',
      });
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(repositoriesResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        apolloClient: apolloClient,
      } as any);

      const result = await githubAdapterInstance.checkGitRemoteAvailableAndValid();

      expect(existsSync).toHaveBeenCalledWith('/home/project1/.git');
      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(apolloClient.query).toHaveBeenCalledWith({ query: repositoriesQuery });
      expect(githubAdapterInstance.config.repository).toEqual({
        __typename: 'GitRepository',
        id: '647250661',
        url: 'https://github.com/test-user/eleventy-sample',
        name: 'eleventy-sample',
        fullName: 'test-user/eleventy-sample',
        defaultBranch: 'main',
      });
      expect(result).toBe(true);
    });

    it('should log an error and exit if git config file does not exists', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(false);
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        log: logMock,
        exit: exitMock,
      } as any);
      let err;

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch (error: any) {
        err = error;
      }

      expect(getRemoteUrls as jest.Mock).not.toHaveBeenCalled();
      expect(logMock).toHaveBeenCalledWith('No Git repository configuration found at /home/project1.', 'error');
      expect(logMock).toHaveBeenCalledWith(
        'Please initialize a Git repository and try again, or use the File Upload option.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
    });

    it(`should log an error if git repo remote url 
      is unavailable and exit`, async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce(undefined);
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        log: logMock,
        exit: exitMock,
      } as any);
      let err;

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch (error: any) {
        err = error;
      }

      expect(existsSync).toHaveBeenCalledWith('/home/project1/.git');
      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(logMock).toHaveBeenCalledWith(
        `No Git remote origin URL found for the repository at /home/project1.
        Please add a git remote origin url and try again`,
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
      expect(githubAdapterInstance.config.repository).toBeUndefined();
    });

    it('should log an error and exit if GitHub app is uninstalled', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/eleventy-sample.git',
      });
      const apolloClient = {
        query: jest.fn().mockRejectedValue(new Error('GitHub app error')),
      } as any;
      const connectToAdapterOnUiMock = jest.spyOn(BaseClass.prototype, 'connectToAdapterOnUi').mockResolvedValueOnce();
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        apolloClient: apolloClient,
        log: logMock,
        exit: exitMock,
      } as any);
      let err;

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch (error: any) {
        err = error;
      }

      expect(existsSync).toHaveBeenCalledWith('/home/project1/.git');
      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(apolloClient.query).toHaveBeenCalled();
      expect(connectToAdapterOnUiMock).toHaveBeenCalled();
      expect(logMock).toHaveBeenCalledWith('GitHub app uninstalled. Please reconnect the app and try again', 'error');
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
    });

    it('should log an error and exit if repository is not found in the list of available repositories', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/test-repo-2.git',
      });
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(repositoriesResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        log: logMock,
        exit: exitMock,
        apolloClient: apolloClient,
      } as any);
      let err;

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch (error: any) {
        err = error;
      }

      expect(existsSync).toHaveBeenCalledWith('/home/project1/.git');
      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(apolloClient.query).toHaveBeenCalledWith({ query: repositoriesQuery });
      expect(logMock).toHaveBeenCalledWith(
        'Repository not added to the GitHub app. Please add it to the app’s repository access list and try again.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
      expect(githubAdapterInstance.config.repository).toBeUndefined();
    });
  });
});
