import EventEmitter from 'events';
import { cliux } from '@contentstack/cli-utilities';
import { ApolloClient, ObservableQuery } from '@apollo/client/core';
import { Ora } from 'ora';

import { LogPollingInput, ConfigType } from '../types';
import { deploymentQuery, deploymentLogsQuery, serverlessLogsQuery } from '../graphql';
import { setTimeout as sleep } from 'timers/promises';

export default class LogPolling {
  private config: ConfigType;
  private $event!: EventEmitter;
  private apolloLogsClient!: ApolloClient<any>;
  private apolloManageClient!: ApolloClient<any>;
  public deploymentStatus!: string;
  public startTime!: number;
  public endTime!: number;
  public loader!: Ora | void;

  constructor(params: LogPollingInput) {
    const { apolloLogsClient, apolloManageClient, config, $event } = params;
    this.apolloLogsClient = apolloLogsClient;
    this.apolloManageClient = apolloManageClient;
    this.config = config;
    if ($event) this.$event = $event;
  }

  /**
   * @method getDeploymentStatus - deployment status polling
   *
   * @return {*}  {ObservableQuery<any, {query: {
                    uid: string | undefined;
                   environment: string | undefined;
                   };}>}
   * @memberof LogPolling
 */
  getDeploymentStatus(): ObservableQuery<
    any,
    {
      query: {
        uid: string | undefined;
        environment: string | undefined;
      };
    }
    > {
    const statusWatchQuery = this.apolloManageClient.watchQuery({
      fetchPolicy: 'network-only',
      query: deploymentQuery,
      variables: {
        query: {
          uid: this.config.deployment,
          environment: this.config.environment,
        },
      },
      pollInterval: this.config.pollingInterval,
      errorPolicy: 'all',
    });
    return statusWatchQuery;
  }

  /**
   * @method deploymentLogs - subscribe deployment status and deployment logs polling
   *
   * @return {*}  {Promise<void>}
   * @memberof LogPolling
   */
  async deploymentLogs(): Promise<void> {
    const statusWatchQuery = this.getDeploymentStatus();
    statusWatchQuery.subscribe(({ data, errors, error }) => {
      if (error) {
        this.$event.emit('deployment-logs', {
          message: error?.message,
          msgType: 'error',
        });
      }
      if (errors?.length && data === null) {
        this.$event.emit('deployment-logs', {
          message: errors,
          msgType: 'error',
        });
        statusWatchQuery.stopPolling();
      }
      this.deploymentStatus = data?.Deployment?.status;
      if (this.config.deploymentStatus.includes(this.deploymentStatus)) {
        this.config.currentDeploymentStatus = this.deploymentStatus;
        statusWatchQuery.stopPolling();
      }
    });
    const logsWatchQuery = this.apolloLogsClient.watchQuery({
      fetchPolicy: 'network-only',
      query: deploymentLogsQuery,
      variables: {
        deploymentUid: this.config.deployment,
      },
      pollInterval: this.config.pollingInterval,
      errorPolicy: 'all',
    });
    this.subscribeDeploymentLogs(logsWatchQuery);
  }

  /**
   * @method subscribeDeploymentLogs - subscribe deployment logs
   *
   * @return {*}  {void}
   * @memberof LogPolling
   */
  subscribeDeploymentLogs(
    logsWatchQuery: ObservableQuery<
      any,
      {
        deploymentUid: string | undefined;
      }
    >,
  ): void {
    let timestamp: number = 0;
    logsWatchQuery.subscribe(async({ data, errors, error }) => {
      if(!this.loader){
        this.loader = cliux.loaderV2('Loading deployment logs...');
      }
      if (error) {
        this.loader=cliux.loaderV2('done', this.loader);
        this.$event.emit('deployment-logs', {
          message: error?.message,
          msgType: 'error',
        });
        this.$event.emit('deployment-logs', {
          message: 'DONE',
          msgType: 'debug',
        });
        logsWatchQuery.stopPolling();
      }
      if (errors?.length && data === null) {
        this.loader=cliux.loaderV2('done', this.loader);
        this.$event.emit('deployment-logs', {
          message: errors,
          msgType: 'error',
        });
        this.$event.emit('deployment-logs', {
          message: 'DONE',
          msgType: 'debug',
        });
        logsWatchQuery.stopPolling();
      }
      if (this.deploymentStatus) {
        const logsData = data?.getLogs;
        if (logsData?.length) {
          this.loader=cliux.loaderV2('done', this.loader);
          this.$event.emit('deployment-logs', {
            message: logsData,
            msgType: 'info',
          });
          timestamp = new Date(logsData[logsData.length - 1].timestamp).getTime() + 1;
          logsWatchQuery.setVariables({
            deploymentUid: this.config.deployment,
            timestamp: new Date(timestamp).toISOString(),
          } as any);
        }

        if (this.config.deploymentStatus.includes(this.deploymentStatus)) {
          await sleep(1_000);
          logsWatchQuery.stopPolling();
          this.$event.emit('deployment-logs', {
            message: 'DONE',
            msgType: 'debug',
          });
          if(this.loader){
            this.loader=cliux.loaderV2('done', this.loader);
          }
        }
      }
    });
  }

  /**
   * @method serverLogs - server logs polling
   *
   * @return {*}  {void}
   * @memberof LogPolling
   */
  async serverLogs(): Promise<void> {
    this.startTime = new Date().getTime() - 10 * 1000;
    this.endTime = new Date().getTime();
    const serverLogsWatchQuery = this.apolloLogsClient.watchQuery({
      fetchPolicy: 'network-only',
      query: serverlessLogsQuery,
      variables: {
        query: {
          environmentUid: this.config.environment,
          startTime: this.startTime,
          endTime: this.endTime,
          deploymentUid: this.config.deployment,
        },
      },
      pollInterval: this.config.pollingInterval,
      errorPolicy: 'all',
    });
    this.subscribeServerLogs(serverLogsWatchQuery);
  }

  /**
   * @method subscribeServerLogs - subscribe server logs
   *
   * @return {*}  {void}
   * @memberof LogPolling
   */
  subscribeServerLogs(
    serverLogsWatchQuery: ObservableQuery<
      any,
      {
        query: {
          environmentUid: string | undefined;
          startTime: number;
          endTime: number;
          deploymentUid: string | undefined;
        };
      }
    >,
  ): void {
    serverLogsWatchQuery.subscribe(({ data, errors, error }) => {
      if(!this.loader){
        this.loader = cliux.loaderV2('Loading server logs...');
      }
      if (error) {
        this.loader=cliux.loaderV2('done', this.loader);
        this.$event.emit('server-logs', { message: error?.message, msgType: 'error' });
      }
      if (errors?.length && data === null) {
        this.loader=cliux.loaderV2('done', this.loader);
        this.$event.emit('server-logs', { message: errors, msgType: 'error' });
        serverLogsWatchQuery.stopPolling();
      }

      const logsData = data?.getServerlessLogs?.logs;
      const logsLength = logsData?.length;
      if (logsLength > 0) {
        this.loader=cliux.loaderV2('done', this.loader);
        this.$event.emit('server-logs', { message: logsData, msgType: 'info' });
        this.startTime = new Date(logsData[logsLength - 1].timestamp).getTime() + 1;
        this.endTime = this.startTime + 10 * 1000;
      } else if (logsLength === 0) {
        this.endTime = this.endTime + 10 * 1000;
      }
      serverLogsWatchQuery.setVariables({
        query: {
          environmentUid: this.config.environment,
          startTime: this.startTime,
          endTime: this.endTime,
          deploymentUid: this.config.deployment,
        },
      });
    });
  }
}
