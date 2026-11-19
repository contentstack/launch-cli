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
  /** The screenshot image taken once the deployment is live, never a URL for the site itself. */
  previewUrl?: string;
  gitBranch?: string;
  commitHash?: string;
  commitMessage?: string;
  environmentVariables?: unknown[] | null;
  isCancellable?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type IdentifiedDeployment = Deployment & { uid: string };

export interface DeploymentLog {
  message?: string;
  timestamp?: string;
  stage?: string;
}

export interface DeploymentResponse {
  deployment: Deployment;
}

export interface DeploymentsPage {
  pagination: Pagination;
  deployments: Deployment[];
}
