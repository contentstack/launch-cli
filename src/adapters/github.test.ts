import GitHub from './github';
import { getRemoteUrls } from '../util/create-git-meta';
import { repositoriesQuery } from '../graphql';
import BaseClass from './base-class';

jest.mock('../util/create-git-meta');

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
  describe('checkGitRemoteAvailableAndValid', () => {
    const repositoriesResponse = { data: { repositories } };
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

    it(`should successfully check if the git remote is available and valid
       when the github remote URL is HTTPS based`, async () => {
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

    it(`should log an error and proceed to connection via UI 
      if git repo remote url is unavailable and exit`, async () => {
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce(undefined);
      const connectToAdapterOnUiMock 
      = jest.spyOn(BaseClass.prototype, 'connectToAdapterOnUi').mockResolvedValueOnce(undefined);
      const githubAdapterInstance = new GitHub({ 
        config: { projectBasePath: '/home/project1' }, 
        log: logMock, 
        exit: exitMock
      } as any);
      let err;

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch (error: any) {
        err = error;
      }


      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(logMock).toHaveBeenCalledWith('GitHub project not identified!', 'error');
      expect(connectToAdapterOnUiMock).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
      expect(githubAdapterInstance.config.repository).toBeUndefined();
    });

    it('should log an error and exit if repository is not found in the list of available repositories', async () => {
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

      expect(getRemoteUrls as jest.Mock).toHaveBeenCalledWith('/home/project1/.git/config');
      expect(apolloClient.query).toHaveBeenCalledWith({ query: repositoriesQuery });
      expect(logMock).toHaveBeenCalledWith('Repository not found in the list!', 'error');
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
      expect(githubAdapterInstance.config.repository).toBeUndefined();
    });
  });
});
