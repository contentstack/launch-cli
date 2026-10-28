import type { Interfaces } from '@oclif/core';

import { EXIT_CANCELLED } from '../../../core/constants';
import { UsageError } from '../../../core/errors';
import { flagsFor, inputs } from '../../../core/inputs';
import { onInterrupt } from '../../../core/interruptible-ux';
import { LaunchCommand } from '../../../core/launch-command';
import type { UxLike } from '../../../core/prompt';
import type { ServiceContext } from '../../../core/service-context';
import { DeploymentUnsuccessfulError, DeploymentWaitInterruptedError } from '../../../deployments/deployment.errors';
import { DeploymentFollower } from '../../../deployments/deployment.follower';
import { fetchDeployment } from '../../../deployments/deployment.resolver';
import { defaultWatchTiming } from '../../../deployments/deployment.watcher';
import { LOG_TYPE_FLAG, windowOnlyWithServer } from '../../../logs/logs.inputs';
import {
  deploymentStatusLine,
  logsWaitTimedOutMessage,
  noDeploymentLogsLine,
  noServerLogsLine,
  serverLogLine,
  serverLogsCapLine,
  serverLogsRetentionLine,
  stoppedFollowingLine,
} from '../../../logs/logs.presenter';
import { parseLogWindow, type LogWindow } from '../../../logs/log-window';
import { SERVER_LOGS_PAGE_CAP } from '../../../logs/types';

const getInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  deployment: {},
  'log-type': {},
  since: {},
  until: {},
});

const { 'log-type': logTypeFlag, ...otherFlags } = flagsFor(getInputs);

interface LogScope {
  org: string;
  project: string;
  environment: string;
  deployment: string;
}

export default class LogsGet extends LaunchCommand<typeof getInputs> {
  static description = 'Read the build or server logs of a deployment of a Launch environment';

  static examples = [
    '$ csdx launch:logs:get --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
    '$ csdx launch:logs:get --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--deployment <deployment-uid> --type server --since 2h',
  ];

  static inputs = getInputs;

  static flags = { ...otherFlags, [LOG_TYPE_FLAG]: logTypeFlag };

  static rules = [windowOnlyWithServer('since'), windowOnlyWithServer('until')];

  protected async parse<
    F extends Record<string, unknown>,
    B extends Record<string, unknown>,
    A extends Record<string, unknown>,
  >(options?: Interfaces.Input<F, B, A>, argv?: string[]): Promise<Interfaces.ParserOutput<F, B, A>> {
    const parsed = await super.parse(options, argv);

    if (LOG_TYPE_FLAG in parsed.flags) {
      Object.assign(parsed.flags, { 'log-type': parsed.flags[LOG_TYPE_FLAG] });
    }

    return parsed;
  }

  async run(): Promise<void> {
    const type = this.resolved['log-type'];

    if (type === 'live') {
      throw new UsageError('--type live is not available yet');
    }

    const { org, project, env: environment } = this.resolved;

    if (type === 'server') {
      const window = parseLogWindow({ since: this.resolved.since, until: this.resolved.until }, () => Date.now());

      await this.printServerLogs(await this.verifiedDeployment({ org, project, environment }), window);
      return;
    }

    const scope = await this.verifiedDeployment({ org, project, environment });

    await this.followDeploymentLogs(scope);
  }

  private async verifiedDeployment(environmentScope: Omit<LogScope, 'deployment'>): Promise<LogScope> {
    const { deployments } = this.services.api;
    const requested = this.resolved.deployment;

    if (requested !== undefined) {
      await fetchDeployment(deployments, { ...environmentScope, deployment: requested });

      return { ...environmentScope, deployment: requested };
    }

    const latest = await deployments.latest(environmentScope);

    if (latest === undefined) {
      throw new UsageError('No deployments found in this environment.');
    }

    return { ...environmentScope, deployment: latest.uid };
  }

  private async printServerLogs(scope: LogScope, window: LogWindow): Promise<void> {
    const outputIsTTY = this.services.outputIsTTY === true;
    const { startTime, endTime, clampedFrom } = window;
    const logs = await this.services.api.serverLogs.window({ ...scope, startTime, endTime });

    if (clampedFrom !== undefined) {
      this.ux.print(serverLogsRetentionLine(clampedFrom, outputIsTTY));
    }

    if (logs.length === 0) {
      this.ux.print(noServerLogsLine(startTime, endTime, outputIsTTY));
      return;
    }

    for (const log of logs) {
      this.ux.print(serverLogLine(log, outputIsTTY, process.stdout.columns));
    }

    if (logs.length === SERVER_LOGS_PAGE_CAP) {
      this.ux.print(serverLogsCapLine(outputIsTTY));
    }
  }

  private async followDeploymentLogs(scope: LogScope): Promise<void> {
    const outputIsTTY = this.services.outputIsTTY === true;
    let printed = 0;
    const counting: UxLike = {
      ...this.ux,
      print: (message) => {
        printed += 1;
        this.ux.print(message);
      },
    };
    const services: ServiceContext = { ...this.services, ux: counting };
    const stop = new AbortController();
    const release = onInterrupt(() => stop.abort(new DeploymentWaitInterruptedError('Stopped following the logs.')));

    try {
      const outcome = await new DeploymentFollower(services, defaultWatchTiming()).watch(scope, stop.signal);

      if (outcome.kind === 'timed-out') {
        throw new DeploymentUnsuccessfulError(logsWaitTimedOutMessage(outcome.status, scope, scope.deployment));
      }

      if (printed === 0) {
        this.ux.print(noDeploymentLogsLine(scope.deployment, outputIsTTY));
      }

      this.ux.print(deploymentStatusLine(outcome.deployment, outcome.status));
    } catch (error) {
      if (stop.signal.aborted && error === stop.signal.reason) {
        this.ux.print(stoppedFollowingLine(outputIsTTY));
        this.exit(EXIT_CANCELLED);
      }

      throw error;
    } finally {
      release();
    }
  }
}
