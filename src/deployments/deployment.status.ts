import { DEPLOYMENT_STATUSES, DeploymentStatus, IN_FLIGHT_STATUSES, SUCCESS_STATUSES } from './types';

export type StatusKind = 'in-flight' | 'success' | 'failure' | 'unknown';

export const UNKNOWN_STATUS = 'UNKNOWN';

function canonical(status: unknown): string | undefined {
  if (typeof status !== 'string') {
    return undefined;
  }

  const trimmed = status.trim().toUpperCase();

  return trimmed === '' ? undefined : trimmed;
}

export function normalizeStatus(status: unknown): string {
  return canonical(status) ?? UNKNOWN_STATUS;
}

export function classifyStatus(status: unknown): StatusKind {
  const value = canonical(status);

  if (value === undefined) {
    return 'unknown';
  }

  if (IN_FLIGHT_STATUSES.includes(value as DeploymentStatus)) {
    return 'in-flight';
  }

  if (SUCCESS_STATUSES.includes(value as DeploymentStatus)) {
    return 'success';
  }

  return DEPLOYMENT_STATUSES.includes(value as DeploymentStatus) ? 'failure' : 'unknown';
}
