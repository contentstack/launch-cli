import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { Choice, PromptDeps } from '../core/prompt';
import { askOption, noteTruncation } from '../core/prompt';
import { hasUid } from '../transport/envelope';
import { classifyStatus } from './deployment.status';
import type { DeploymentScope } from './deployments.api';
import type { IdentifiedDeployment } from './types';

export const ALL_DEPLOYMENTS = 'all';

export const IN_FLIGHT_DEPLOYMENTS = 'in-flight';

const SHORT_COMMIT_LENGTH = 7;

const NO_DEPLOYMENTS = 'No deployments found that can be rolled back.';

const NO_IN_FLIGHT_DEPLOYMENTS = 'No deployments in progress that can be cancelled.';

const QUESTIONS: Record<string, string> = {
  [ALL_DEPLOYMENTS]: 'Choose a deployment to roll back to',
  [IN_FLIGHT_DEPLOYMENTS]: 'Choose a deployment to cancel',
};

function when(deployment: IdentifiedDeployment): string | undefined {
  const commit = deployment.commitHash?.trim();

  if (commit) {
    return commit.slice(0, SHORT_COMMIT_LENGTH);
  }

  return deployment.createdAt?.trim() || deployment.updatedAt?.trim() || undefined;
}

function isCancellable(deployment: IdentifiedDeployment): boolean {
  return classifyStatus(deployment.status) === 'in-flight' && deployment.isCancellable !== false;
}

function withoutCurrent(deployments: IdentifiedDeployment[]): IdentifiedDeployment[] {
  const current = deployments.findIndex((deployment) => deployment.status?.trim().toUpperCase() === 'LIVE');

  return deployments.filter((_deployment, index) => index !== current);
}

export function deploymentChoice(deployment: IdentifiedDeployment): Choice {
  const status = deployment.status?.trim() || '-';
  const detail = when(deployment);

  const parts = [deployment.uid, status, detail].filter((part) => part !== undefined);

  return { name: parts.join('  '), value: deployment.uid };
}

export async function promptForDeployment(
  deps: PromptDeps,
  scope: DeploymentScope,
  picker: string | undefined,
): Promise<string> {
  const inFlightOnly = picker === IN_FLIGHT_DEPLOYMENTS;
  const page = await deps.api.deployments.list({
    ...scope,
    limit: PICKER_PAGE_SIZE,
    skip: 0,
    ...(inFlightOnly ? {} : { rollbackEligible: true }),
  });
  const identified = page.deployments.filter(hasUid);
  const choosable = inFlightOnly ? identified.filter(isCancellable) : withoutCurrent(identified);

  if (choosable.length === 0) {
    throw new UsageError(inFlightOnly ? NO_IN_FLIGHT_DEPLOYMENTS : NO_DEPLOYMENTS);
  }

  if (!inFlightOnly) {
    noteTruncation(deps.ux, page.pagination.count, page.deployments.length, 'deployments', '--deployment');
  }

  const question = QUESTIONS[inFlightOnly ? IN_FLIGHT_DEPLOYMENTS : ALL_DEPLOYMENTS];

  return askOption(deps.ux, question, choosable.map(deploymentChoice));
}
