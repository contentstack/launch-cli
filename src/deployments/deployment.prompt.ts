import { PICKER_PAGE_SIZE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { Choice, PromptDeps } from '../core/prompt';
import { askOption, noteTruncation } from '../core/prompt';
import { withoutControlCharacters } from '../core/values';
import { hasUid } from '../transport/envelope';
import { classifyStatus } from './deployment.status';
import type { DeploymentScope } from './deployments.api';
import type { Deployment, IdentifiedDeployment } from './types';

export const ALL_DEPLOYMENTS = 'all';

export const IN_FLIGHT_DEPLOYMENTS = 'in-flight';

const SHORT_COMMIT_LENGTH = 7;

const NO_DEPLOYMENTS = 'No deployments are available for rollback.';

const NO_IN_FLIGHT_DEPLOYMENTS = 'No in-progress deployments are available for cancellation.';

const QUESTIONS: Record<string, string> = {
  [ALL_DEPLOYMENTS]: 'Choose a deployment for rollback',
  [IN_FLIGHT_DEPLOYMENTS]: 'Choose a deployment for cancellation',
};

function printable(value: string | undefined): string {
  return withoutControlCharacters(value ?? '').trim();
}

function when(deployment: IdentifiedDeployment): string | undefined {
  const commit = printable(deployment.commitHash);

  if (commit) {
    return commit.slice(0, SHORT_COMMIT_LENGTH);
  }

  return printable(deployment.createdAt) || printable(deployment.updatedAt) || undefined;
}

export function isCancellable(deployment: Pick<Deployment, 'status' | 'isCancellable'>): boolean {
  return classifyStatus(deployment.status) === 'in-flight' && deployment.isCancellable !== false;
}

function withoutCurrent(deployments: IdentifiedDeployment[]): IdentifiedDeployment[] {
  const current = deployments.findIndex((deployment) => deployment.status?.trim().toUpperCase() === 'LIVE');

  return deployments.filter((_deployment, index) => index !== current);
}

export function deploymentChoice(deployment: IdentifiedDeployment): Choice {
  const status = printable(deployment.status) || '-';
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
