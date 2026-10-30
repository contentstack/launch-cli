import { gql, DocumentNode } from '@apollo/client/core';

const createDeploymentMutation: DocumentNode = gql`
  mutation CreateDeployment(
    $deployment: CreateDeploymentInput!
    $skipGitData: Boolean = false
  ) {
    deployment: createDeployment(deployment: $deployment) {
      uid
      status
      commitUrl @skip(if: $skipGitData)
      createdAt
      updatedAt
      commitHash @skip(if: $skipGitData)
      commitMessage
      deploymentUrl
    }
  }
`;

const createSignedUploadUrlMutation: DocumentNode = gql`
  mutation CreateSignedUploadUrl($secured: Boolean = true) {
    signedUploadUrl: createSignedUploadUrl(secured: $secured) {
      expiresIn
      uploadUid
      uploadUrl
      fields {
        formFieldKey
        formFieldValue
      }
      headers{
        key
        value
      }
      method
    }
  }
`;

const importProjectMutation: DocumentNode = gql`
  mutation importProject($project: ImportProjectInput!, $skipGitData: Boolean = false) {
    project: importProject(project: $project) {
      uid
      name
      projectType
      organizationUid
      environments {
        uid
        name
        frameworkPreset
        deployments {
          edges {
            node {
              uid
              status
              commitUrl @skip(if: $skipGitData)
              createdAt
              updatedAt
              deploymentUrl
              commitHash @skip(if: $skipGitData)
              commitMessage
            }
          }
        }
      }
      repository @skip(if: $skipGitData) {
        username
        repositoryName
        gitProviderMetadata {
          ... on GitHubMetadata {
            gitProvider
          }
        }
      }
    }
  }
`;

const rollbackDeploymentMutation: DocumentNode = gql`
  mutation RollbackDeployment($input: RollbackDeploymentInput!) {
    rollbackDeployment(input: $input) {
      status
      environmentUid
    }
  }
`;

const addEnvironmentSecretMutation: DocumentNode = gql`
  mutation AddEnvironmentSecret($environment: EnvironmentInput!, $secret: EnvironmentSecretInput!) {
    addEnvironmentSecret(environment: $environment, secret: $secret) {
      key
      updatedAt
    }
  }
`;

const refreshEnvironmentSecretMutation: DocumentNode = gql`
  mutation RefreshEnvironmentSecret($environment: EnvironmentInput!, $secret: EnvironmentSecretInput!) {
    refreshEnvironmentSecret(environment: $environment, secret: $secret) {
      key
      updatedAt
    }
  }
`;

const deleteEnvironmentSecretMutation: DocumentNode = gql`
  mutation DeleteEnvironmentSecret($environment: EnvironmentInput!, $secret: EnvironmentSecretKeyInput!) {
    deleteEnvironmentSecret(environment: $environment, secret: $secret)
  }
`;

export {
  importProjectMutation,
  addEnvironmentSecretMutation,
  refreshEnvironmentSecretMutation,
  deleteEnvironmentSecretMutation,
  createDeploymentMutation,
  rollbackDeploymentMutation,
  createSignedUploadUrlMutation,
};
