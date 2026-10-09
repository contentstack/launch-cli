import type { LaunchError } from '../core/errors';
import type { TableColumn } from '../core/render';
import { styled } from '../core/style';
import { LaunchApiError } from '../transport/errors';
import type { GitOnlyFlag } from './project.inputs';
import type { Project } from './types';

export const PROJECT_COLUMNS: TableColumn<Project>[] = [
  { header: 'NAME', value: (project) => project.name ?? '-' },
  { header: 'TYPE', value: (project) => project.projectType ?? '-' },
  { header: 'UID', value: (project) => project.uid ?? '-' },
];

export const PROJECT_DETAIL_COLUMNS: TableColumn<Project>[] = [
  ...PROJECT_COLUMNS,
  { header: 'DESCRIPTION', value: (project) => project.description ?? '-' },
];

export const PROJECT_DESCRIPTION_COLUMN = PROJECT_DETAIL_COLUMNS.length - 1;

export const PROJECT_DELETE_QUESTION = 'Are you sure you want to delete this project?';

export const PROJECT_DELETED = '\u2714 Project deleted successfully.';

export function projectDeletedLine(outputIsTTY: boolean): string {
  return styled(PROJECT_DELETED, 'green', outputIsTTY);
}

export const PROJECT_NOT_DELETED = 'Project not deleted.';

export function projectNotDeletedLine(outputIsTTY: boolean): string {
  return styled(PROJECT_NOT_DELETED, 'yellow', outputIsTTY);
}

export const RENAME_PROJECT_QUESTION = 'Would you like to change the project\'s name and try again?';

const V1_PROJECT_LIMIT_CAUSE = 'Launch project limit reached!';
const V1_FILE_SIZE_CAUSE = 'Please use a file over the size of 1KB and under the size of 100MB.';
const FILE_SIZE_CODES: readonly string[] = [
  'launch.DEPLOYMENT.INVALID_FILE_SIZE',
  'launch.DEPLOYMENT.FILE_UPLOAD_FAILED',
];

export function projectCreatedLine(outputIsTTY: boolean): string {
  return styled('info: New project created successfully', 'green', outputIsTTY);
}

/**
 * V1 opened every create failure with this line, then named the cause on the next - in its own words for
 * the limit and file-size cases, by the error's message otherwise. A duplicate name goes on to the rename
 * question, the retry-limit warning in yellow, or - with no terminal to rename in - the way out in green.
 */
export function projectCreationFailedLine(outputIsTTY: boolean): string {
  return styled('error: New project creation failed!', 'red', outputIsTTY);
}

export function duplicateProjectNameLine(outputIsTTY: boolean): string {
  return styled('error: Duplicate project name identified', 'red', outputIsTTY);
}

export function createFailureCauseLine(failure: LaunchError, outputIsTTY: boolean): string {
  return styled(`error: ${createFailureCause(failure)}`, 'red', outputIsTTY);
}

function createFailureCause(failure: LaunchError): string {
  const code = failure instanceof LaunchApiError ? failure.code : undefined;

  if (code === 'launch.PROJECT.LIMIT_REACHED') {
    return V1_PROJECT_LIMIT_CAUSE;
  }

  if (code !== undefined && FILE_SIZE_CODES.includes(code)) {
    return V1_FILE_SIZE_CAUSE;
  }

  return failure.message;
}

export function renameRetryLimitLine(outputIsTTY: boolean): string {
  return styled('warn: Reached max project creation retry limit', 'yellow', outputIsTTY);
}

export function renameAndRerunLine(outputIsTTY: boolean): string {
  return styled('info: Change the project name and re-run the command.', 'green', outputIsTTY);
}

export function gitOnlyFlagLine(flag: GitOnlyFlag, outputIsTTY: boolean): string {
  return styled(`warn: --${flag} is not supported for FileUpload projects.`, 'yellow', outputIsTTY);
}

export interface PartialCreateFailure {
  projectName: string;
  projectUid: string;
  environmentName: string;
  status: string;
  org: string;
  environmentUid?: string;
  deploymentUid?: string;
  reason?: string;
  timedOut?: boolean;
}

export function deploymentFailureMessage(failure: PartialCreateFailure): string {
  const scope = `--org ${failure.org} --project ${failure.projectUid}`;
  const environment = failure.environmentUid === undefined ? '' : ` --env ${failure.environmentUid}`;
  const deployment = failure.deploymentUid === undefined ? '' : ` --deployment ${failure.deploymentUid}`;

  if (failure.timedOut === true) {
    return (
      `The deployment was still ${failure.status} when the CLI stopped waiting for it; it may still finish. ` +
      `The project "${failure.projectName}" (${failure.projectUid}) and its environment ` +
      `"${failure.environmentName}" were created. Do not start another deployment yet: ` +
      `run csdx launch:deployments:get ${scope}${environment}${deployment} to see how it ends, ` +
      `or csdx launch:logs:get ${scope}${environment}${deployment} to follow it.`
    );
  }

  const opening =
    failure.reason === undefined
      ? `The deployment did not succeed; its last status was ${failure.status}. `
      : `The deployment could not be followed to completion: ${failure.reason} `;

  return (
    opening +
    `The project "${failure.projectName}" (${failure.projectUid}) and its environment ` +
    `"${failure.environmentName}" were created and have not been rolled back. ` +
    `Run csdx launch:deployments:create ${scope}${environment} to try the deployment again, ` +
    `or csdx launch:logs:get ${scope}${environment}${deployment} to see why it did not succeed.`
  );
}

export const PROJECT_UPDATED = '\u2714 Project updated successfully.';

export function projectUpdatedLine(outputIsTTY: boolean): string {
  return styled(PROJECT_UPDATED, 'green', outputIsTTY);
}

export const PROJECT_NOT_UPDATED = 'Project not updated. No changes were entered.';

export function projectNotUpdatedLine(outputIsTTY: boolean): string {
  return styled(PROJECT_NOT_UPDATED, 'yellow', outputIsTTY);
}
