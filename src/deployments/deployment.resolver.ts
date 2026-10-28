import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { DEPLOYMENT_NOT_FOUND_CODE } from './deployment.errors';
import type { DeploymentsApi, GetDeploymentParams } from './deployments.api';
import type { Deployment } from './types';

export function deploymentNotFound(uid: string): UsageError {
  return new UsageError(`No deployment with UID "${uid}" found in this environment.`);
}

export async function fetchDeployment(
  deployments: Pick<DeploymentsApi, 'get'>,
  params: GetDeploymentParams,
): Promise<Deployment> {
  try {
    return await deployments.get(params);
  } catch (error) {
    if (error instanceof LaunchApiError && error.status === 404 && error.code === DEPLOYMENT_NOT_FOUND_CODE) {
      throw deploymentNotFound(params.deployment);
    }

    throw error;
  }
}
