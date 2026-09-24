import type { Pagination } from '../core/render';

export type { Pagination };

export const DEPLOYMENT_STATUSES = [
  'QUEUED',
  'LIVE',
  'DEPLOYED',
  'ARCHIVED',
  'DEPLOYING',
  'SKIPPED',
  'FAILED',
  'CANCELLED',
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const IN_FLIGHT_STATUSES: readonly DeploymentStatus[] = ['QUEUED', 'DEPLOYING'];

export const SUCCESS_STATUSES: readonly DeploymentStatus[] = ['LIVE', 'DEPLOYED'];

export interface Deployment {
  uid?: string;
  status?: string;
  deploymentNumber?: number;
  deploymentUrl?: string;
  previewUrl?: string;
  gitBranch?: string;
  commitHash?: string;
  commitMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type IdentifiedDeployment = Deployment & { uid: string };

export interface DeploymentResponse {
  deployment: Deployment;
}

export interface DeploymentsPage {
  pagination: Pagination;
  deployments: Deployment[];
}
