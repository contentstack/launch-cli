export const ORG = { uid: 'org-uid-1', name: 'Integration Org' };
export const OTHER_ORG = { uid: 'org-uid-2', name: 'Second Org' };

export const PROJECT_UID = 'project-uid-1';
export const PROJECT_NAME = 'integration-project';
export const ENVIRONMENT_UID = 'env-uid-1';
export const ENVIRONMENT_NAME = 'Default';
export const DEPLOYMENT_UID = 'deployment-uid-1';
export const DEPLOYMENT_URL = 'integration-project.contentstackapps.com';

export const REPOSITORY = {
  __typename: 'GitRepository',
  id: 'repo-id-1',
  url: 'https://github.com/launch-org/integration-project',
  name: 'integration-project',
  fullName: 'launch-org/integration-project',
  defaultBranch: 'main',
};

export const deploymentNode = (overrides: Record<string, any> = {}) => ({
  __typename: 'Deployment',
  uid: DEPLOYMENT_UID,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:05:00.000Z',
  commitMessage: 'initial commit',
  deploymentUrl: DEPLOYMENT_URL,
  deploymentNumber: 1,
  status: 'LIVE',
  ...overrides,
});

export const environmentNode = (overrides: Record<string, any> = {}) => ({
  __typename: 'Environment',
  uid: ENVIRONMENT_UID,
  name: ENVIRONMENT_NAME,
  frameworkPreset: 'GATSBY',
  deployments: {
    __typename: 'DeploymentConnection',
    edges: [{ __typename: 'DeploymentEdge', node: deploymentNode() }],
  },
  ...overrides,
});

export const environmentsResponse = (nodes: Record<string, any>[] = [environmentNode()]) => ({
  data: {
    Environments: {
      __typename: 'EnvironmentConnection',
      edges: nodes.map((node) => ({ __typename: 'EnvironmentEdge', node })),
    },
  },
});

export const projectsResponse = (
  projects: { uid: string; name: string }[] = [{ uid: PROJECT_UID, name: PROJECT_NAME }],
) => ({
  data: {
    projects: {
      __typename: 'ProjectConnection',
      edges: projects.map(({ uid, name }) => ({
        __typename: 'ProjectEdge',
        node: {
          __typename: 'Project',
          uid,
          name,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'user-uid-1',
          updatedBy: 'user-uid-1',
          description: '',
          projectType: 'GITPROVIDER',
          cmsStackApiKey: '',
          organizationUid: ORG.uid,
          repository: {
            __typename: 'GitHubRepository',
            repositoryName: REPOSITORY.fullName,
            repositoryUrl: REPOSITORY.url,
            username: 'launch-org',
            gitProviderMetadata: { __typename: 'GitHubMetadata', gitProvider: 'GitHub' },
          },
        },
      })),
    },
  },
});

export const userConnectionsResponse = (
  connections: { provider?: string; namespace?: string | null }[] = [{ provider: 'GitHub' }],
) => ({
  data: {
    userConnections: connections.map(({ provider = 'GitHub', namespace = null }) => ({
      __typename: 'UserConnection',
      userUid: 'github-user-uid',
      provider,
      namespace,
    })),
  },
});

export const repositoriesResponse = (
  repositories: Record<string, any>[] = [REPOSITORY],
  hasNextPage = false,
  page = 1,
) => ({
  data: {
    repositories: {
      __typename: 'GitRepositoryConnection',
      edges: repositories.map((node, index) => ({
        __typename: 'GitRepositoryEdge',
        node,
        cursor: `cursor-${index}`,
      })),
      pageData: { __typename: 'PageData', page },
      pageInfo: { __typename: 'PageInfo', hasNextPage },
    },
  },
});

export const branchesResponse = (branches = ['main', 'develop'], hasNextPage = false, page = 1) => ({
  data: {
    branches: {
      __typename: 'GitBranchConnection',
      edges: branches.map((name, index) => ({
        __typename: 'GitBranchEdge',
        node: { __typename: 'GitBranch', name },
        cursor: `cursor-${index}`,
      })),
      pageData: { __typename: 'PageData', page },
      pageInfo: { __typename: 'PageInfo', hasNextPage },
    },
  },
});

export const frameworkResponse = (preset = 'GATSBY') => ({
  data: { framework: { __typename: 'FrameworkDetail', framework: preset } },
});

export const fileFrameworkResponse = (preset = 'GATSBY') => ({
  data: { framework: { __typename: 'FrameworkDetail', framework: preset } },
});

export const importProjectResponse = (overrides: Record<string, any> = {}) => ({
  data: {
    project: {
      __typename: 'Project',
      uid: PROJECT_UID,
      name: PROJECT_NAME,
      projectType: 'GITPROVIDER',
      organizationUid: ORG.uid,
      environments: [
        {
          __typename: 'Environment',
          uid: ENVIRONMENT_UID,
          name: ENVIRONMENT_NAME,
          frameworkPreset: 'GATSBY',
          deployments: {
            __typename: 'DeploymentConnection',
            edges: [
              {
                __typename: 'DeploymentEdge',
                node: {
                  __typename: 'Deployment',
                  uid: DEPLOYMENT_UID,
                  status: 'QUEUED',
                  commitUrl: `${REPOSITORY.url}/commit/abc123`,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                  deploymentUrl: DEPLOYMENT_URL,
                  commitHash: 'abc123',
                  commitMessage: 'initial commit',
                },
              },
            ],
          },
        },
      ],
      repository: {
        __typename: 'GitHubRepository',
        username: 'launch-org',
        repositoryName: REPOSITORY.fullName,
        gitProviderMetadata: { __typename: 'GitHubMetadata', gitProvider: 'GitHub' },
      },
      ...overrides,
    },
  },
});

export const importFileUploadProjectResponse = () => {
  const response = importProjectResponse({ projectType: 'FILEUPLOAD' });
  const node = response.data.project.environments[0].deployments.edges[0].node as Record<string, any>;
  delete node.commitUrl;
  delete node.commitHash;
  delete (response.data.project as Record<string, any>).repository;
  return response;
};

export const createDeploymentResponse = (overrides: Record<string, any> = {}) => ({
  data: {
    deployment: {
      __typename: 'Deployment',
      uid: DEPLOYMENT_UID,
      status: 'QUEUED',
      commitUrl: `${REPOSITORY.url}/commit/abc123`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      commitHash: 'abc123',
      commitMessage: 'initial commit',
      deploymentUrl: DEPLOYMENT_URL,
      ...overrides,
    },
  },
});

export const signedUploadUrlResponse = (uploadUrl: string) => ({
  data: {
    signedUploadUrl: {
      __typename: 'SignedUploadUrl',
      expiresIn: 600,
      uploadUid: 'upload-uid-1',
      uploadUrl,
      fields: [],
      headers: [{ __typename: 'SignedUploadHeader', key: 'x-amz-test', value: 'test' }],
      method: 'PUT',
    },
  },
});

export const signedUploadUrlWithFormFieldsResponse = (uploadUrl: string) => ({
  data: {
    signedUploadUrl: {
      __typename: 'SignedUploadUrl',
      expiresIn: 600,
      uploadUid: 'upload-uid-1',
      uploadUrl,
      fields: [
        { __typename: 'SignedUploadField', formFieldKey: 'key', formFieldValue: 'uploads/bundle.zip' },
        { __typename: 'SignedUploadField', formFieldKey: 'policy', formFieldValue: 'test-policy' },
      ],
      headers: [],
      method: 'POST',
    },
  },
});

export const deploymentStatusResponse = (status = 'LIVE') => ({
  data: { Deployment: { __typename: 'Deployment', status, uid: DEPLOYMENT_UID } },
});

export const deploymentLogsV2Response = (
  messages: string[] = ['Build started', 'Build finished'],
  hasNewer = false,
) => ({
  data: {
    getDeploymentLogsV2: {
      __typename: 'DeploymentLogsV2',
      logs: messages.map((message, index) => ({
        __typename: 'DeploymentLogV2',
        deploymentUid: DEPLOYMENT_UID,
        message,
        stage: 'BUILD',
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      })),
      pageInfo: { __typename: 'LogPageInfo', hasNewer, newestCursor: 'cursor-newest' },
    },
  },
});

export const deploymentLogsV1Response = (messages: string[] = ['Legacy build log']) => ({
  data: {
    getLogs: messages.map((message, index) => ({
      __typename: 'DeploymentLog',
      deploymentUid: DEPLOYMENT_UID,
      message,
      stage: 'BUILD',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  },
});

export const deploymentLogsV2UnsupportedResponse = () => ({
  errors: [{ message: 'Cannot query field "getDeploymentLogsV2" on type "Query".' }],
});

export const fileSizeRejectedResponse = (code = 'launch.DEPLOYMENT.FILE_UPLOAD_FAILED') => ({
  errors: [
    {
      message: 'Bad request',
      extensions: { exception: { errorObject: { uploadUid: [{ code }] }, status: 400 } },
    },
  ],
});

export const latestLiveDeploymentResponse = (uid = DEPLOYMENT_UID) => ({
  data: {
    latestLiveDeployment: {
      __typename: 'Deployment',
      uid,
      environment: ENVIRONMENT_UID,
      deploymentNumber: 2,
      deploymentUrl: DEPLOYMENT_URL,
      status: 'LIVE',
      gitBranch: 'main',
      commitHash: 'abc123',
      commitMessage: 'latest live commit',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  },
});

export const rollbackDeploymentResponse = (status = 'QUEUED') => ({
  data: {
    rollbackDeployment: {
      __typename: 'RollbackDeploymentResult',
      status,
      environmentUid: ENVIRONMENT_UID,
    },
  },
});

export const existingProjectConfigFile = (project: Record<string, any> = {}, key = 'project') => ({
  [key]: {
    uid: PROJECT_UID,
    name: PROJECT_NAME,
    organizationUid: ORG.uid,
    projectType: 'GITPROVIDER',
    environments: [{ uid: ENVIRONMENT_UID, name: ENVIRONMENT_NAME, frameworkPreset: 'GATSBY' }],
    deployments: [deploymentNode()],
    ...project,
  },
});
