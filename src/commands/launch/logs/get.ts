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
import { LOG_TYPE_FLAG, onlyWithServer } from '../../../logs/logs.inputs';
import {
  deploymentStatusLine,
  logsWaitTimedOutMessage,
  noDeploymentLogsLine,
  noServerLogsLine,
  serverLogLine,
  serverLogsPageCapLine,
  serverLogsResumeLine,
  serverLogsRetentionLine,
  stoppedFollowingLine,
} from '../../../logs/logs.presenter';
import { LiveLogFollower } from '../../../logs/live-log.follower';
import { parseLogWindow, type LogWindow } from '../../../logs/log-window';
import { nextCursorOf } from '../../../logs/server-logs.api';

const getInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  deployment: {},
  'log-type': {},
  since: {},
  until: {},
  search: {},
  cursor: {},
});

const { 'log-type': logTypeFlag, ...otherFlags } = flagsFor(getInputs);

interface ServerResume {
  cursor?: string;
}

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

  static rules = [
    onlyWithServer('since'),
    onlyWithServer('until'),
    onlyWithServer('search'),
    onlyWithServer('cursor'),
  ];

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
    const { org, project, env: environment } = this.resolved;

    if (type === 'server') {
      const window = parseLogWindow({ since: this.resolved.since, until: this.resolved.until }, () => Date.now());
      const scope = await this.verifiedDeployment({ org, project, environment });
      const resume: ServerResume = {};

      await this.untilInterrupted(
        (stop) => this.printServerLogs(scope, window, stop, resume),
        () => (resume.cursor === undefined ? [] : [this.resumeLine(scope, window, resume.cursor)]),
      );
      return;
    }

    const scope = await this.verifiedDeployment({ org, project, environment });

    await this.untilInterrupted((stop) =>
      type === 'live' ? this.followLiveLogs(scope, stop) : this.followDeploymentLogs(scope, stop),
    );
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

  private resumeLine(scope: LogScope, { startTime, endTime }: LogWindow, cursor: string): string {
    return serverLogsResumeLine({ ...scope, startTime, endTime, search: this.resolved.search, cursor });
  }

  private async printServerLogs(
    scope: LogScope,
    window: LogWindow,
    stop: AbortSignal,
    resume: ServerResume,
  ): Promise<void> {
    const outputIsTTY = this.services.outputIsTTY === true;
    const { startTime, endTime, clampedFrom } = window;
    const { search, cursor } = this.resolved;
    let printed = 0;

    if (clampedFrom !== undefined) {
      this.ux.print(serverLogsRetentionLine(clampedFrom, outputIsTTY));
    }

    for await (const page of this.services.api.serverLogs.pages({ ...scope, startTime, endTime, search, cursor })) {
      for (const log of page.logs) {
        this.ux.print(serverLogLine(log, outputIsTTY, process.stdout.columns));
        printed += 1;
      }

      resume.cursor = nextCursorOf(page);

      if (stop.aborted) {
        throw stop.reason;
      }
    }

    if (printed === 0) {
      this.ux.print(noServerLogsLine(startTime, endTime, outputIsTTY, search));
    }

    if (resume.cursor !== undefined) {
      this.ux.print(serverLogsPageCapLine(outputIsTTY));
      this.ux.print(this.resumeLine(scope, window, resume.cursor));
    }
  }

  private async untilInterrupted(
    follow: (stop: AbortSignal) => Promise<void>,
    afterStopped: () => string[] = () => [],
  ): Promise<void> {
    const stop = new AbortController();
    const release = onInterrupt(() => stop.abort(new DeploymentWaitInterruptedError('Stopped following the logs.')));

    try {
      await follow(stop.signal);
    } catch (error) {
      if (stop.signal.aborted && error === stop.signal.reason) {
        this.ux.print(stoppedFollowingLine(this.services.outputIsTTY === true));

        for (const line of afterStopped()) {
          this.ux.print(line);
        }

        this.exit(EXIT_CANCELLED);
      }

      throw error;
    } finally {
      release();
    }
  }

  private followLiveLogs(scope: LogScope, stop: AbortSignal): Promise<void> {
    return new LiveLogFollower(this.services, defaultWatchTiming(), { columns: process.stdout.columns }).follow(
      scope,
      stop,
    );
  }

  private async followDeploymentLogs(scope: LogScope, stop: AbortSignal): Promise<void> {
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
    const outcome = await new DeploymentFollower(services, defaultWatchTiming()).watch(scope, stop);

    if (outcome.kind === 'timed-out') {
      throw new DeploymentUnsuccessfulError(logsWaitTimedOutMessage(outcome.status, scope, scope.deployment));
    }

    if (printed === 0) {
      this.ux.print(noDeploymentLogsLine(scope.deployment, outputIsTTY));
    }

    this.ux.print(deploymentStatusLine(outcome.deployment, outcome.status));
  }
}
