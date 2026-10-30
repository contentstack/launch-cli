import { DeploymentsApi, type GetDeploymentParams } from '../deployments/deployments.api';
import type { EventStreamClient, StreamFrame } from '../transport/event-stream';
import { LOGS_ERROR_MESSAGES } from './logs.errors';

export interface LiveLogHandlers {
  onFrame(frame: StreamFrame): void;
}

export class LiveLogsApi {
  constructor(private readonly client: EventStreamClient) {}

  open(scope: GetDeploymentParams, handlers: LiveLogHandlers, signal: AbortSignal): Promise<void> {
    return this.client.open(
      { path: `${DeploymentsApi.pathOf(scope)}/logs/live`, orgUid: scope.org, projectUid: scope.project },
      handlers.onFrame,
      signal,
      LOGS_ERROR_MESSAGES,
    );
  }
}
