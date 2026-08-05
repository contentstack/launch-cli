import { gql, DocumentNode } from '@apollo/client/core';

const userConnectionsQuery: DocumentNode = gql`
  query UserConnections(
    $query: QueryUserConnectionInput! = { provider: "GitHub" }
  ) {
    userConnections: UserConnections(query: $query) {
      userUid
      provider
      namespace
    }
  }
`;

const repositoriesQuery: DocumentNode = gql`
  query GitRepositories(
    $first: Float = 100
    $page: Float = 1
    $query: RepositoriesInput! = { provider: "GitHub" }
  ) {
    repositories: GitRepositories(query: $query, first: $first, page: $page) {
      edges {
        node {
          id
          url
          name
          fullName
          defaultBranch
        }
        cursor
      }
      pageData {
        page
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const frameworkQuery = gql`
  query Framework($query: GitProviderFrameworkInput!) {
    framework: Framework(query: $query) {
      framework
    }
  }
`;

const fileFrameworkQuery = gql`
  query FileFramework($query: FileUploadFrameworkInput!) {
    framework: FileFramework(query: $query) {
      framework
    }
  }
`;

const cmsEnvironmentVariablesQuery = gql`
  query cmsEnvironmentVariables {
    envVariables: cmsEnvironmentVariables {
      key
      keyName
      value
    }
  }
`;

const branchesQuery = gql`
  query GitBranches(
    $first: Float = 100
    $page: Float = 1
    $query: BranchesInput!
  ) {
    branches: GitBranches(query: $query, first: $first, page: $page) {
      edges {
        node {
          name
        }
        cursor
      }
      pageData {
        page
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const projectsQuery: DocumentNode = gql`
  query Projects($query: QueryProjectsInput!) {
    projects: Projects(query: $query) {
      edges {
        node {
          uid
          name
          createdAt
          updatedAt
          createdBy
          updatedBy
          description
          projectType
          cmsStackApiKey
          organizationUid
          repository {
            repositoryName
            repositoryUrl
            username
            gitProviderMetadata {
              ... on GitHubMetadata {
                gitProvider
              }
            }
          }
        }
      }
    }
  }
`;

const deploymentQuery: DocumentNode = gql`
  query getDeploymentsById($query: DeploymentInput!) {
    Deployment(query: $query) {
      status
      uid
    }
  }
`;

const deploymentLogsQuery: DocumentNode = gql`
  query GetLogs($deploymentUid: ID!, $timestamp: String) {
    getLogs(deploymentUid: $deploymentUid, timestamp: $timestamp) {
      deploymentUid
      message
      stage
      timestamp
    }
  }
`;


const deploymentLogsV2Query: DocumentNode = gql`
  query GetDeploymentLogsV2($query: DeploymentLogsV2QueryInput!) {
    getDeploymentLogsV2(query: $query) {
      logs {
        deploymentUid
        message
        stage
        timestamp
      }
      pageInfo {
        hasNewer
        newestCursor
      }
    }
  }
`;

const serverlessLogsQuery: DocumentNode = gql`
  query GetServerlessLogsV2($query: QueryLogMessagesV2InputType!) {
    getServerlessLogsV2(query: $query) {
      logs {
        source
        message
        timestamp
      }
    }
  }
`;

const latestLiveDeploymentQuery: DocumentNode = gql`
  query LatestLiveDeployment($query: QueryDeploymentsInput!) {
    latestLiveDeployment(query: $query) {
      uid
      environment
      deploymentNumber
      deploymentUrl
      status
      gitBranch
      commitHash
      commitMessage
      createdAt
    }
  }
`;

const environmentsQuery: DocumentNode = gql`
  query Environments($skipRollbackData: Boolean = true) {
    Environments {
      edges {
        node {
          uid
          name
          frameworkPreset
          deployments {
            edges {
              node {
                uid
                createdAt
                commitMessage
                deploymentUrl
                deploymentNumber
                status @skip(if: $skipRollbackData)
                gitBranch @skip(if: $skipRollbackData)
                commitHash @skip(if: $skipRollbackData)
                isRollbackEligible @skip(if: $skipRollbackData)
              }
            }
          }
        }
      }
    }
  }
`;

export {
  projectsQuery,
  branchesQuery,
  frameworkQuery,
  repositoriesQuery,
  fileFrameworkQuery,
  userConnectionsQuery,
  cmsEnvironmentVariablesQuery,
  deploymentQuery,
  deploymentLogsQuery,
  deploymentLogsV2Query,
  serverlessLogsQuery,
  latestLiveDeploymentQuery,
  environmentsQuery,
};
