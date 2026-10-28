import { stripVTControlCharacters } from 'node:util';

import type { TableColumn } from '../core/render';
import { styled } from '../core/style';
import { isAbsent, messageOf } from '../core/values';
import type { Deployment, DeploymentLog } from './types';

const GUTTER = '  ';
const CLOCK_WIDTH = 8;
const CONTINUATION = ' '.repeat(CLOCK_WIDTH + GUTTER.length);
const NARROWEST_WRAP = 24;

/* eslint-disable no-control-regex */
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)/g;
const NON_SGR_CSI = /[\u001b\u009b]\[[0-?]*[ -/]*[@-ln-~]/g;
const LONE_ESCAPE = /\u001b[^[\]]/g;
const OVERWRITING_CONTROL = /[\u0007\u0008\u000b\u000c]|\r(?!\n)/g;
const COLOUR_SEQUENCE = /[\u001b\u009b]\[[0-9;:]*m/g;
/* eslint-enable no-control-regex */

export function deploymentUrlOf(deployment: Deployment): string | undefined {
  const url = deployment.deploymentUrl || deployment.previewUrl;

  if (!url) {
    return undefined;
  }

  return url.startsWith('http') ? url : `https://${url}`;
}

export function deploymentUrlLine(url: string, outputIsTTY: boolean): string {
  return `${styled('Deployment URL', 'bold', outputIsTTY)} ${styled(url, 'cyan', outputIsTTY)}`;
}

export function colouredLogMessage(message: string): string {
  return message
    .replace(OSC_SEQUENCE, '')
    .replace(NON_SGR_CSI, '')
    .replace(LONE_ESCAPE, '')
    .replace(OVERWRITING_CONTROL, '');
}

function printableUnits(message: string): string[] {
  const units: string[] = [];
  let plainFrom = 0;

  COLOUR_SEQUENCE.lastIndex = 0;

  for (let found = COLOUR_SEQUENCE.exec(message); found !== null; found = COLOUR_SEQUENCE.exec(message)) {
    units.push(...message.slice(plainFrom, found.index), found[0]);
    plainFrom = found.index + found[0].length;
  }

  units.push(...message.slice(plainFrom));

  return units;
}

export function wrapLogMessage(message: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  let printed = 0;
  let breakAfter = -1;
  let breakPrinted = 0;

  for (const unit of printableUnits(message)) {
    const colour = unit.length > 1;

    if (!colour && printed === width) {
      const carried = breakAfter === -1 ? '' : row.slice(breakAfter);
      rows.push(breakAfter === -1 ? row : row.slice(0, breakAfter).trimEnd());
      row = carried;
      printed = breakAfter === -1 ? 0 : printed - breakPrinted;
      breakAfter = -1;
    }

    if (!colour && unit === ' ' && printed === 0 && rows.length > 0) {
      continue;
    }

    row += unit;

    if (!colour) {
      printed += 1;

      if (unit === ' ') {
        breakAfter = row.length;
        breakPrinted = printed;
      }
    }
  }

  rows.push(row);

  return rows;
}

export function clockOf(time: number): string {
  const at = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

function stampOf(time: number): string {
  return `${new Date(time).toISOString().slice(0, 23).replace('T', ' ')}:`;
}

export function deploymentLogLine(log: DeploymentLog, outputIsTTY: boolean, columns?: number): string {
  const time = Date.parse(log.timestamp ?? '');
  const raw = log.message ?? '';
  const message = outputIsTTY ? colouredLogMessage(raw) : stripVTControlCharacters(raw);

  if (Number.isNaN(time)) {
    return message;
  }

  if (!outputIsTTY) {
    return message === '' ? stampOf(time) : `${stampOf(time)}${GUTTER}${message}`;
  }

  const stamp = styled(clockOf(time), 'dim', outputIsTTY);

  if (message === '') {
    return stamp;
  }

  const width = (columns ?? 0) - CONTINUATION.length;

  if (width < NARROWEST_WRAP) {
    return `${stamp}${GUTTER}${message}`;
  }

  return wrapLogMessage(message, width)
    .map((row, index) => (index === 0 ? `${stamp}${GUTTER}${row}` : `${CONTINUATION}${row}`))
    .join('\n');
}

export function deploymentLogsUnavailableLine(error: unknown): string {
  const reason = messageOf(error);

  return `  ! Could not read the deployment logs (${reason}). Still waiting on the deployment.`;
}

export interface FirstDeploymentFailure {
  created: string;
  plural: boolean;
  org: string;
  project: string;
  status: string;
  environmentUid?: string;
  deploymentUid?: string;
  reason?: string;
  timedOut?: boolean;
}

export function firstDeploymentFailureMessage(failure: FirstDeploymentFailure): string {
  const scope = `--org ${failure.org} --project ${failure.project}`;
  const environment = failure.environmentUid === undefined ? '' : ` --env ${failure.environmentUid}`;
  const deployment = failure.deploymentUid === undefined ? '' : ` --deployment ${failure.deploymentUid}`;
  const were = failure.plural ? 'were' : 'was';

  if (failure.timedOut === true) {
    return (
      `The deployment was still ${failure.status} when the CLI stopped waiting for it; it may still finish. ` +
      `${failure.created} ${were} created. Do not start another deployment yet: ` +
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
    `${failure.created} ${were} created and ${failure.plural ? 'have' : 'has'} not been rolled back. ` +
    `Run csdx launch:deployments:create ${scope}${environment} to try the deployment again, ` +
    `or csdx launch:logs:get ${scope}${environment}${deployment} to see why it did not succeed.`
  );
}

export function deploymentRollbackQuestion(uid: string): string {
  return `Roll back this environment to deployment "${uid}"?`;
}

export function deploymentCancelQuestion(uid: string): string {
  return `Cancel deployment "${uid}"? This cannot be undone.`;
}

export function rolledBackLine(uid: string, outputIsTTY: boolean): string {
  return styled(`\u2714 Rolled back to deployment "${uid}"`, 'green', outputIsTTY);
}

export function deploymentCancelledLine(uid: string, outputIsTTY: boolean): string {
  return styled(`\u2714 Deployment "${uid}" cancelled.`, 'green', outputIsTTY);
}

export function deploymentNotRolledBackLine(outputIsTTY: boolean): string {
  return styled('Deployment not rolled back.', 'yellow', outputIsTTY);
}

export function deploymentNotCancelledLine(outputIsTTY: boolean): string {
  return styled('Deployment not cancelled.', 'yellow', outputIsTTY);
}

export interface DeploymentDetailRow {
  field: string;
  value: string;
}

export interface DeploymentScopeLabels {
  org: string;
  project: string;
  environment: string;
}

const SHORT_COMMIT_LENGTH = 7;

function text(value: string | undefined | null): string {
  return value === undefined || value === null || isAbsent(value) ? '-' : value;
}

function shortCommit(value: string | undefined): string {
  const hash = text(value);

  return hash.length > SHORT_COMMIT_LENGTH ? hash.slice(0, SHORT_COMMIT_LENGTH) : hash;
}

export function deploymentColumns(showGit: boolean): TableColumn<Deployment>[] {
  const columns: TableColumn<Deployment>[] = [
    { header: 'DEPLOYMENT UID', value: (deployment) => text(deployment.uid) },
    { header: 'STATUS', value: (deployment) => text(deployment.status) },
  ];

  if (showGit) {
    columns.push({ header: 'COMMIT', value: (deployment) => shortCommit(deployment.commitHash) });
  }

  columns.push({ header: 'UPDATED', value: (deployment) => text(deployment.updatedAt) });

  if (showGit) {
    columns.push({ header: 'BRANCH', value: (deployment) => text(deployment.gitBranch) });
  }

  return columns;
}

export const DEPLOYMENT_DETAIL_COLUMNS: TableColumn<DeploymentDetailRow>[] = [
  { header: 'FIELD', value: (row) => row.field },
  { header: 'VALUE', value: (row) => row.value },
];

export const DEPLOYMENT_VALUE_COLUMN = 1;

export function deploymentLogsHint(scope: DeploymentScopeLabels, deploymentUid: string): string {
  const flags = `--org ${scope.org} --project ${scope.project} --env ${scope.environment}`;

  return `csdx launch:logs:get ${flags} --deployment ${deploymentUid}`;
}

export function deploymentVariablesSummary(deployment: Deployment): string {
  const count = Array.isArray(deployment.environmentVariables) ? deployment.environmentVariables.length : 0;

  return `${count} (list them with csdx launch:variables:list)`;
}

export function deploymentDetailRows(
  deployment: Deployment,
  scope: DeploymentScopeLabels,
  showGit: boolean,
): DeploymentDetailRow[] {
  const gitRows: DeploymentDetailRow[] = [
    { field: 'BRANCH', value: text(deployment.gitBranch) },
    { field: 'COMMIT', value: text(deployment.commitHash) },
    { field: 'COMMIT MESSAGE', value: text(deployment.commitMessage) },
  ];
  const logs =
    deployment.uid === undefined || isAbsent(deployment.uid) ? '-' : deploymentLogsHint(scope, deployment.uid);

  return [
    { field: 'DEPLOYMENT UID', value: text(deployment.uid) },
    { field: 'STATUS', value: text(deployment.status) },
    ...(showGit ? gitRows : []),
    { field: 'URL', value: text(deploymentUrlOf(deployment)) },
    { field: 'ENVIRONMENT VARIABLES', value: deploymentVariablesSummary(deployment) },
    { field: 'CREATED AT', value: text(deployment.createdAt) },
    { field: 'UPDATED AT', value: text(deployment.updatedAt) },
    { field: 'BUILD LOGS', value: logs },
  ];
}
