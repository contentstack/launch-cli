import { githubAdapter as cliUtilitiesJestMock } from '../test/mocks/cli-utilities';
import GitHub, { MAX_REPOSITORY_PAGES } from './github';
import { getRemoteUrls } from '../util/create-git-meta';
import { repositoriesQuery, userConnectionsQuery } from '../graphql';
import BaseClass from './base-class';
import { existsSync } from 'fs';
import { DeploymentStatus } from '../types';
import { cliux as ux } from '@contentstack/cli-utilities';

jest.mock('@contentstack/cli-utilities', () => cliUtilitiesJestMock);

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

    it('should prompt the user to select a connection when multiple GitHub connections exist', async () => {
      const multipleUserConnections = [
        { __typename: 'UserConnection', userUid: 'testuser1', provider: 'GitHub', namespace: 'personal-account' },
        { __typename: 'UserConnection', userUid: 'testuser1', provider: 'GitHub', namespace: 'org-account' },
      ];
      const userConnectionResponse = { data: { userConnections: multipleUserConnections } };
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(userConnectionResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1', provider: 'GitHub' },
        apolloClient: apolloClient,
        log: logMock,
      } as any);
      (ux.inquire as jest.Mock).mockResolvedValueOnce('org-account');

      await githubAdapterInstance.checkGitHubConnected();

      expect(ux.inquire).toHaveBeenCalledWith({
        type: 'search-list',
        name: 'userConnection',
        message: 'Choose a GitHub Namespace',
        choices: ['personal-account', 'org-account'],
      });
      expect(githubAdapterInstance.config.userConnection).toEqual(multipleUserConnections[1]);
    });

    it('should use the --namespace flag to select a connection without prompting', async () => {
      const multipleUserConnections = [
        { __typename: 'UserConnection', userUid: 'testuser1', provider: 'GitHub', namespace: 'personal-account' },
        { __typename: 'UserConnection', userUid: 'testuser1', provider: 'GitHub', namespace: 'org-account' },
      ];
      const userConnectionResponse = { data: { userConnections: multipleUserConnections } };
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(userConnectionResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1', provider: 'GitHub', flags: { namespace: 'org-account' } },
        apolloClient: apolloClient,
        log: logMock,
      } as any);

      await githubAdapterInstance.checkGitHubConnected();

      expect(ux.inquire).not.toHaveBeenCalled();
      expect(githubAdapterInstance.config.userConnection).toEqual(multipleUserConnections[1]);
    });

    it('should log an error and exit if the --namespace flag does not match any connection', async () => {
      const multipleUserConnections = [
        { __typename: 'UserConnection', userUid: 'testuser1', provider: 'GitHub', namespace: 'personal-account' },
        { __typename: 'UserConnection', userUid: 'testuser1', provider: 'GitHub', namespace: 'org-account' },
      ];
      const userConnectionResponse = { data: { userConnections: multipleUserConnections } };
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(userConnectionResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1', provider: 'GitHub', flags: { namespace: 'unknown-account' } },
        apolloClient: apolloClient,
        log: logMock,
        exit: exitMock,
      } as any);

      let err;
      try {
        await githubAdapterInstance.checkGitHubConnected();
      } catch (error: any) {
        err = error;
      }

      expect(ux.inquire).not.toHaveBeenCalled();
      expect(logMock).toHaveBeenCalledWith('GitHub connection namespace not found!', 'error');
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
    });
  });

  describe('checkGitRemoteAvailableAndValid', () => {
    const repositoriesResponse = {
      data: {
        repositories: {
          edges: repositories.map((node) => ({ node })),
          pageData: { page: 1 },
          pageInfo: { hasNextPage: false },
        },
      },
    };

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
      expect(apolloClient.query).toHaveBeenCalledWith({
        query: repositoriesQuery,
        variables: { page: 1, first: 100 },
      });
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
       when the github remote URL embeds userinfo (https://user@github.com/...)`, async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://test-user@github.com/test-user/eleventy-sample.git',
      });
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(repositoriesResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        apolloClient: apolloClient,
      } as any);

      const result = await githubAdapterInstance.checkGitRemoteAvailableAndValid();

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
      expect(apolloClient.query).toHaveBeenCalledWith({
        query: repositoriesQuery,
        variables: { page: 1, first: 100 },
      });
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

    it('should scope the repositories query to the selected GitHub connection namespace', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/eleventy-sample.git',
      });
      const apolloClient = {
        query: jest.fn().mockResolvedValueOnce(repositoriesResponse),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: {
          projectBasePath: '/home/project1',
          provider: 'GitHub',
          userConnection: { provider: 'GitHub', namespace: 'org-account' },
        },
        apolloClient: apolloClient,
      } as any);

      await githubAdapterInstance.checkGitRemoteAvailableAndValid();

      expect(apolloClient.query).toHaveBeenCalledWith({
        query: repositoriesQuery,
        variables: { page: 1, first: 100, query: { provider: 'GitHub', namespace: 'org-account' } },
      });
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

    it('should reference the selected connection namespace when the GitHub app is uninstalled', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/eleventy-sample.git',
      });
      const apolloClient = {
        query: jest.fn().mockRejectedValue(new Error('GitHub app error')),
      } as any;
      jest.spyOn(BaseClass.prototype, 'connectToAdapterOnUi').mockResolvedValueOnce();
      const githubAdapterInstance = new GitHub({
        config: {
          projectBasePath: '/home/project1',
          userConnection: { provider: 'GitHub', namespace: 'org-account' },
        },
        apolloClient: apolloClient,
        log: logMock,
        exit: exitMock,
      } as any);

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch {
        // exitMock throws to halt the flow under test, same as sibling tests in this file
      }

      expect(logMock).toHaveBeenCalledWith(
        'GitHub app uninstalled for the "org-account" connection. Please reconnect the app and try again',
        'error',
      );
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
      expect(apolloClient.query).toHaveBeenCalledWith({
        query: repositoriesQuery,
        variables: { page: 1, first: 100 },
      });
      expect(logMock).toHaveBeenCalledWith(
        'Repository not added to the GitHub app. Please add it to the app’s repository access list and try again.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
      expect(githubAdapterInstance.config.repository).toBeUndefined();
    });

    it('should log an error and exit if the remote URL format is unsupported', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://gitlab.com/test-user/some-repo.git',
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

      expect(logMock).toHaveBeenCalledWith(
        'Unsupported Git remote URL format: https://gitlab.com/test-user/some-repo.git. Please use a standard GitHub HTTPS or SSH remote URL.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
      expect(githubAdapterInstance.config.repository).toBeUndefined();
    });

    it('should paginate beyond the first page to find a repository on a later page', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/repo-301.git',
      });

      const PER_PAGE = 100;
      const FULL_PAGES = 3; // target sits on the 4th (partial) page, well within the cap
      const targetRepo = {
        __typename: 'GitRepository',
        id: '301',
        url: 'https://github.com/test-user/repo-301',
        name: 'repo-301',
        fullName: 'test-user/repo-301',
        defaultBranch: 'main',
      };

      const apolloClient = {
        query: jest.fn().mockImplementation(({ variables }) => {
          const { page } = variables;
          const edges =
            page <= FULL_PAGES
              ? Array.from({ length: PER_PAGE }, (_, i) => ({
                node: {
                  __typename: 'GitRepository',
                  id: `${(page - 1) * PER_PAGE + i}`,
                  url: `https://github.com/test-user/repo-${(page - 1) * PER_PAGE + i}`,
                  name: `repo-${(page - 1) * PER_PAGE + i}`,
                  fullName: `test-user/repo-${(page - 1) * PER_PAGE + i}`,
                  defaultBranch: 'main',
                },
              }))
              : [{ node: targetRepo }];
          return Promise.resolve({ data: { repositories: { edges, pageData: { page }, pageInfo: { hasNextPage: false } } } });
        }),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: { projectBasePath: '/home/project1' },
        apolloClient: apolloClient,
      } as any);

      const result = await githubAdapterInstance.checkGitRemoteAvailableAndValid();

      // 3 full pages + 1 partial page = 4 requests.
      expect(apolloClient.query).toHaveBeenCalledTimes(FULL_PAGES + 1);
      expect(githubAdapterInstance.config.repository).toEqual(targetRepo);
      expect(result).toBe(true);
    });

    it(`should cap pagination at ${MAX_REPOSITORY_PAGES} pages (1000 repositories) for consistency with the management service`, async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/missing-repo.git',
      });

      // Every page is full, so without a cap the loop would never stop on its own.
      const apolloClient = {
        query: jest.fn().mockImplementation(({ variables }) => {
          const { page, first } = variables;
          const edges = Array.from({ length: first }, (_, i) => ({
            node: {
              __typename: 'GitRepository',
              id: `${(page - 1) * first + i}`,
              url: `https://github.com/test-user/repo-${(page - 1) * first + i}`,
              name: `repo-${(page - 1) * first + i}`,
              fullName: `test-user/repo-${(page - 1) * first + i}`,
              defaultBranch: 'main',
            },
          }));
          return Promise.resolve({ data: { repositories: { edges, pageData: { page }, pageInfo: { hasNextPage: true } } } });
        }),
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

      expect(apolloClient.query).toHaveBeenCalledTimes(MAX_REPOSITORY_PAGES);
      expect(logMock).toHaveBeenCalledWith(
        expect.stringContaining('beyond the first 1000 repositories the GitHub App can access'),
        'error',
      );
      expect(logMock).not.toHaveBeenCalledWith(
        'Repository not added to the GitHub app. Please add it to the app’s repository access list and try again.',
        'error',
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(err).toEqual(new Error('1'));
    });

    it('should reference the selected connection namespace when the repository is beyond the checked pages', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(true);
      (getRemoteUrls as jest.Mock).mockResolvedValueOnce({
        origin: 'https://github.com/test-user/missing-repo.git',
      });
      const apolloClient = {
        query: jest.fn().mockImplementation(({ variables }) => {
          const { page, first } = variables;
          const edges = Array.from({ length: first }, (_, i) => ({
            node: {
              __typename: 'GitRepository',
              id: `${(page - 1) * first + i}`,
              url: `https://github.com/test-user/repo-${(page - 1) * first + i}`,
              name: `repo-${(page - 1) * first + i}`,
              fullName: `test-user/repo-${(page - 1) * first + i}`,
              defaultBranch: 'main',
            },
          }));
          return Promise.resolve({ data: { repositories: { edges, pageData: { page }, pageInfo: { hasNextPage: true } } } });
        }),
      } as any;
      const githubAdapterInstance = new GitHub({
        config: {
          projectBasePath: '/home/project1',
          userConnection: { provider: 'GitHub', namespace: 'org-account' },
        },
        log: logMock,
        exit: exitMock,
        apolloClient: apolloClient,
      } as any);

      try {
        await githubAdapterInstance.checkGitRemoteAvailableAndValid();
      } catch {
        // exitMock throws to halt the flow under test, same as sibling tests in this file
      }

      expect(logMock).toHaveBeenCalledWith(expect.stringContaining('the "org-account" connection'), 'error');
    });
  });

  describe('runGitHubFlow', () => {
    let getEnvironmentMock: jest.SpyInstance;
    let handleExistingProjectMock: jest.SpyInstance;
    let handleNewProjectMock: jest.SpyInstance;
    let prepareLaunchConfigMock: jest.SpyInstance;
    let showLogsMock: jest.SpyInstance;
    let showDeploymentUrlMock: jest.SpyInstance;
    let showSuggestionMock: jest.SpyInstance;

    beforeEach(() => {
      getEnvironmentMock = jest
        .spyOn(BaseClass.prototype, 'getEnvironment')
        .mockResolvedValue({ uid: 'env-123', name: 'Default', frameworkPreset: 'OTHER' });
      handleExistingProjectMock = jest
        .spyOn(GitHub.prototype as any, 'handleExistingProject')
        .mockResolvedValue(undefined);
      handleNewProjectMock = jest
        .spyOn(GitHub.prototype as any, 'handleNewProject')
        .mockResolvedValue(undefined);
      prepareLaunchConfigMock = jest.spyOn(BaseClass.prototype, 'prepareLaunchConfig').mockImplementation(() => {});
      showLogsMock = jest.spyOn(BaseClass.prototype, 'showLogs').mockResolvedValue(true);
      showDeploymentUrlMock = jest.spyOn(BaseClass.prototype, 'showDeploymentUrl').mockImplementation(() => {});
      showSuggestionMock = jest.spyOn(BaseClass.prototype, 'showSuggestion').mockImplementation(() => {});
    });

    afterEach(() => {
      getEnvironmentMock.mockRestore();
      handleExistingProjectMock.mockRestore();
      handleNewProjectMock.mockRestore();
      prepareLaunchConfigMock.mockRestore();
      showLogsMock.mockRestore();
      showDeploymentUrlMock.mockRestore();
      showSuggestionMock.mockRestore();
    });

    it('should exit with code 1 when deployment status is FAILED for existing project', async () => {
      const githubInstance = new GitHub({
        config: {
          isExistingProject: true,
          currentDeploymentStatus: DeploymentStatus.FAILED,
        },
        log: logMock,
        exit: exitMock,
      } as any);

      try {
        await githubInstance.run();
      } catch (error: any) {
        expect(error.message).toBe('1');
      }

      expect(getEnvironmentMock).toHaveBeenCalled();
      expect(handleExistingProjectMock).toHaveBeenCalled();
      expect(prepareLaunchConfigMock).toHaveBeenCalled();
      expect(showLogsMock).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(showDeploymentUrlMock).not.toHaveBeenCalled();
      expect(showSuggestionMock).not.toHaveBeenCalled();
    });

    it('should exit with code 1 when deployment status is FAILED for new project', async () => {
      const githubInstance = new GitHub({
        config: {
          isExistingProject: false,
          currentDeploymentStatus: DeploymentStatus.FAILED,
        },
        log: logMock,
        exit: exitMock,
      } as any);

      try {
        await githubInstance.run();
      } catch (error: any) {
        expect(error.message).toBe('1');
      }

      expect(handleNewProjectMock).toHaveBeenCalled();
      expect(prepareLaunchConfigMock).toHaveBeenCalled();
      expect(showLogsMock).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(showDeploymentUrlMock).not.toHaveBeenCalled();
      expect(showSuggestionMock).not.toHaveBeenCalled();
    });

    it('should continue normally when deployment status is not FAILED', async () => {
      const githubInstance = new GitHub({
        config: {
          isExistingProject: true,
          currentDeploymentStatus: DeploymentStatus.LIVE,
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await githubInstance.run();

      expect(getEnvironmentMock).toHaveBeenCalled();
      expect(handleExistingProjectMock).toHaveBeenCalled();
      expect(prepareLaunchConfigMock).toHaveBeenCalled();
      expect(showLogsMock).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
      expect(showDeploymentUrlMock).toHaveBeenCalled();
      expect(showSuggestionMock).toHaveBeenCalled();
    });
  });

  describe('prepareForNewProjectCreation', () => {
    let selectOrgMock: jest.SpyInstance;
    let selectBranchMock: jest.SpyInstance;
    let detectFrameworkMock: jest.SpyInstance;
    let handleEnvImportFlowMock: jest.SpyInstance;

    beforeEach(() => {
      selectOrgMock = jest.spyOn(BaseClass.prototype, 'selectOrg').mockResolvedValue();
      selectBranchMock = jest.spyOn(BaseClass.prototype, 'selectBranch').mockResolvedValue();
      detectFrameworkMock = jest.spyOn(BaseClass.prototype, 'detectFramework').mockResolvedValue();
      handleEnvImportFlowMock = jest.spyOn(BaseClass.prototype, 'handleEnvImportFlow').mockResolvedValue();
    });

    afterEach(() => {
      selectOrgMock.mockRestore();
      selectBranchMock.mockRestore();
      detectFrameworkMock.mockRestore();
      handleEnvImportFlowMock.mockRestore();
    });

    it('should prompt for server command when framework supports it and serverCommand is not provided', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm start'); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: 'OTHER',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await githubInstance.prepareForNewProjectCreation();

      expect(ux.inquire).toHaveBeenCalledWith({
        type: 'input',
        name: 'serverCommand',
        message: 'Server Command',
      });
      expect(githubInstance.config.serverCommand).toBe('npm start');
    });

    it('should not prompt for server command when framework does not support it', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public'); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await githubInstance.prepareForNewProjectCreation();

      const serverCommandCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
    });

    it('should not prompt for server command when serverCommand is already provided in flags', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': 'npm run serve',
          },
          framework: 'OTHER',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await githubInstance.prepareForNewProjectCreation();

      const serverCommandCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
      expect(githubInstance.config.flags['server-command']).toBe('npm run serve');
    });

    it('should not set serverCommand when user provides empty input', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce(''); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: 'OTHER',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await githubInstance.prepareForNewProjectCreation();

      expect(ux.inquire).toHaveBeenCalledWith({
        type: 'input',
        name: 'serverCommand',
        message: 'Server Command',
      });
      expect(githubInstance.config.serverCommand).toBeUndefined();
    });

    it('should not prompt for server command when framework is not set', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': undefined,
          },
          framework: undefined,
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      await githubInstance.prepareForNewProjectCreation();

      const serverCommandCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
    });

    it('should prompt Enable Streaming Responses after server command when response-mode omitted for OTHER preset',
      async () => {
        (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
        (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
        (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
        (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 
        (ux.inquire as jest.Mock).mockResolvedValueOnce('npm start');
        (ux.inquire as jest.Mock).mockResolvedValueOnce('streaming');

        const githubInstance = new GitHub({
          config: {
            flags: {
              'server-command': undefined,
              'response-mode': undefined,
            },
            framework: 'OTHER',
            repository: { fullName: 'test-user/repo', name: 'repo' },
            supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
            outputDirectories: { OTHER: './dist' },
          },
          log: logMock,
          exit: exitMock,
        } as any);
        
        const handleEnvImportFlowMock = jest
          .spyOn(githubInstance, 'handleEnvImportFlow' as any)
          .mockResolvedValue(undefined);

        await githubInstance.prepareForNewProjectCreation();

        expect(ux.inquire).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'search-list',
            name: 'responseMode',
            message: 'Response mode',
            choices: [
              { name: 'Buffered', value: 'buffered' },
              { name: 'Streaming', value: 'streaming' },
            ],
          }),
        );
        expect(githubInstance.config.isStreamingEnabled).toBe(true);
        
        handleEnvImportFlowMock.mockRestore();
      });

    it('should not prompt Enable Streaming Response when response-mode flag is streaming', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': 'npm start',
            'response-mode': 'streaming',
          },
          framework: 'OTHER',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);
      
      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const enableStreamingCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'responseMode',
      );
      expect(enableStreamingCalls.length).toBe(0);
      expect(githubInstance.config.isStreamingEnabled).toBe(true);
      
      handleEnvImportFlowMock.mockRestore();
    });

    it('should not prompt Enable Streaming Response when response-mode flag is buffered', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build'); 
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./dist'); 

      const githubInstance = new GitHub({
        config: {
          flags: {
            'server-command': 'npm start',
            'response-mode': 'buffered',
          },
          framework: 'OTHER',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { OTHER: './dist' },
        },
        log: logMock,
        exit: exitMock,
      } as any);
      
      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const enableStreamingCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'responseMode',
      );
      expect(enableStreamingCalls.length).toBe(0);
      expect(githubInstance.config.isStreamingEnabled).toBe(false);
      
      handleEnvImportFlowMock.mockRestore();
    });

    it('should prompt Enable Streaming Responses for Gatsby when flag is not provided', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('buffered');

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': undefined,
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const serverCommandCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'serverCommand',
      );
      expect(serverCommandCalls.length).toBe(0);
      expect(ux.inquire).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search-list',
          name: 'responseMode',
          message: 'Response mode',
          choices: [
            { name: 'Buffered', value: 'buffered' },
            { name: 'Streaming', value: 'streaming' },
          ],
        }),
      );
      expect(githubInstance.config.isStreamingEnabled).toBe(false);

      handleEnvImportFlowMock.mockRestore();
    });

    it('should apply response-mode flag for Gatsby without prompt', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': 'streaming',
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const enableStreamingCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'responseMode',
      );
      expect(enableStreamingCalls.length).toBe(0);
      expect(githubInstance.config.isStreamingEnabled).toBe(true);

      handleEnvImportFlowMock.mockRestore();
    });

    it.each([
      ['streaming', true],
      ['buffered', false],
    ])('should map Response Mode selection "%s" to isStreamingEnabled %s', async (input, expected) => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (ux.inquire as jest.Mock).mockResolvedValueOnce(input);

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': undefined,
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      expect(githubInstance.config.isStreamingEnabled).toBe(expected);

      handleEnvImportFlowMock.mockRestore();
    });

    it('Response Mode prompt should offer buffered and streaming choices', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('streaming');

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': undefined,
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const responseModeCall = (ux.inquire as jest.Mock).mock.calls.find(
        (call) => call[0]?.name === 'responseMode',
      );

      expect(responseModeCall[0].type).toBe('search-list');
      expect(responseModeCall[0].choices).toEqual([
        { name: 'Buffered', value: 'buffered' },
        { name: 'Streaming', value: 'streaming' },
      ]);

      handleEnvImportFlowMock.mockRestore();
    });

    it('should prompt Enable Contentstack Authentication (default enabled) when disable-cs-auth flag is not provided', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (ux.inquire as jest.Mock).mockResolvedValueOnce(true);

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': 'buffered',
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      expect(ux.inquire).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirm',
          name: 'contentstackAuth',
          default: true,
        }),
      );
      expect(githubInstance.config.isContentstackAuthenticationEnabled).toBe(true);

      handleEnvImportFlowMock.mockRestore();
    });

    it('should map a "no" answer at the prompt to disabled Contentstack Authentication', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');
      (ux.inquire as jest.Mock).mockResolvedValueOnce(false);

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': 'buffered',
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      expect(githubInstance.config.isContentstackAuthenticationEnabled).toBe(false);

      handleEnvImportFlowMock.mockRestore();
    });


    it('should disable Contentstack Authentication without prompt when --disable-cs-auth is passed', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': 'buffered',
            'disable-cs-auth': true,
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const contentstackAuthCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'contentstackAuth',
      );
      expect(contentstackAuthCalls.length).toBe(0);
      expect(githubInstance.config.isContentstackAuthenticationEnabled).toBe(false);

      handleEnvImportFlowMock.mockRestore();
    });

    it('should enable Contentstack Authentication without prompt when --enable-cs-auth is passed', async () => {
      (ux.inquire as jest.Mock).mockResolvedValueOnce('test-project');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('Default');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('npm run build');
      (ux.inquire as jest.Mock).mockResolvedValueOnce('./public');

      const githubInstance = new GitHub({
        config: {
          flags: {
            'response-mode': 'buffered',
            'enable-cs-auth': true,
          },
          framework: 'GATSBY',
          repository: { fullName: 'test-user/repo', name: 'repo' },
          supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT'],
          outputDirectories: { GATSBY: './public' },
        },
        log: logMock,
        exit: exitMock,
      } as any);

      const handleEnvImportFlowMock = jest
        .spyOn(githubInstance, 'handleEnvImportFlow' as any)
        .mockResolvedValue(undefined);

      await githubInstance.prepareForNewProjectCreation();

      const contentstackAuthCalls = (ux.inquire as jest.Mock).mock.calls.filter(
        (call) => call[0]?.name === 'contentstackAuth',
      );
      expect(contentstackAuthCalls.length).toBe(0);
      expect(githubInstance.config.isContentstackAuthenticationEnabled).toBe(true);

      handleEnvImportFlowMock.mockRestore();
    });
  });
});
