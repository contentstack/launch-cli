import { MAX_PAGES } from '../core/constants';
import { DEPLOYMENT_WAIT_TIMEOUT_MS } from '../deployments/deployment.watcher';
import { clockOf, deploymentLogLine } from '../deployments/deployment.presenter';
import type { Deployment } from '../deployments/types';
import { styled } from '../core/style';
import { isRecord } from '../core/values';
import type { ServerLog } from './types';

const MS_PER_MINUTE = 60_000;

interface DeploymentScopeLabels {
  org: string;
  project: string;
  environment: string;
}

function deploymentLogsHint(scope: DeploymentScopeLabels, deploymentUid: string): string {
  const flags = `--org ${scope.org} --project ${scope.project} --env ${scope.environment}`;

  return `csdx launch:logs:get ${flags} --deployment ${deploymentUid}`;
}

export interface ServerLogsResume extends DeploymentScopeLabels {
  deployment: string;
  startTime: number;
  endTime: number;
  search?: string;
  cursor: string;
}

function shellQuoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isoOf(time: number): string {
  return new Date(time).toISOString();
}

function timestampOf(value: ServerLog['timestamp']): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? isoOf(value) : undefined;
  }

  return typeof value === 'string' ? value : undefined;
}

export function serverLogLine(log: ServerLog, outputIsTTY: boolean, columns?: number): string {
  const entry: ServerLog = isRecord(log) ? log : {};
  const message = typeof entry.message === 'string' ? entry.message : undefined;

  return deploymentLogLine({ message, timestamp: timestampOf(entry.timestamp) }, outputIsTTY, columns);
}

export function noDeploymentLogsLine(deployment: string, outputIsTTY: boolean): string {
  return styled(`No deployment logs found for deployment ${deployment}.`, 'yellow', outputIsTTY);
}

export function noServerLogsLine(startTime: number, endTime: number, outputIsTTY: boolean, search?: string): string {
  const found = search === undefined ? 'found' : `matched "${search}"`;

  return styled(`No server logs ${found} between ${isoOf(startTime)} and ${isoOf(endTime)}.`, 'yellow', outputIsTTY);
}

export function serverLogsPageCapLine(outputIsTTY: boolean): string {
  return styled(`Stopped after ${MAX_PAGES} pages of server logs; more remain in this window.`, 'yellow', outputIsTTY);
}

export function serverLogsResumeLine(resume: ServerLogsResume): string {
  const window = `--type server --since ${isoOf(resume.startTime)} --until ${isoOf(resume.endTime)}`;
  const search = resume.search === undefined ? '' : ` --search ${shellQuoted(resume.search)}`;

  return (
    `Resume with: ${deploymentLogsHint(resume, resume.deployment)} ${window}` +
    `${search} --cursor ${shellQuoted(resume.cursor)}`
  );
}

export function serverLogsRetentionLine(clampedFrom: number, outputIsTTY: boolean): string {
  return styled(`Server logs are kept for 24 hours; showing from ${isoOf(clampedFrom)}.`, 'yellow', outputIsTTY);
}

export function stoppedFollowingLine(outputIsTTY: boolean): string {
  return styled('Stopped following the logs.', 'yellow', outputIsTTY);
}

export function liveSessionLine(endsAt: number, outputIsTTY: boolean): string {
  return styled(`Live session ends at ${clockOf(endsAt)}; press Ctrl-C to stop.`, 'dim', outputIsTTY);
}

export function liveSessionEndedLine(): string {
  return 'The live session ended (server limit). Run the command again to keep following.';
}

export function noLiveLinesLine(outputIsTTY: boolean): string {
  return styled('No live server logs arrived during this session.', 'yellow', outputIsTTY);
}

export function liveStreamLostMessage(attempts: number): string {
  return (
    `Lost the connection to the live server logs after ${attempts} attempts. ` +
    'Check your network connection and run the command again.'
  );
}

export function deploymentStatusLine(deployment: Deployment, status: string): string {
  const number = typeof deployment.deploymentNumber === 'number' ? ` #${deployment.deploymentNumber}` : '';

  return `Deployment${number} is ${status}.`;
}

export function logsWaitTimedOutMessage(status: string, scope: DeploymentScopeLabels, deployment: string): string {
  return (
    `Stopped waiting after ${DEPLOYMENT_WAIT_TIMEOUT_MS / MS_PER_MINUTE} minutes; ` +
    `the deployment was still ${status}. Run ${deploymentLogsHint(scope, deployment)} again to keep following it.`
  );
}
