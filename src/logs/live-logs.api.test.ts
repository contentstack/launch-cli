import { randomBytes } from 'node:crypto';

import type { EventStreamClient, EventStreamRequest, StreamFrame } from '../transport/event-stream';
import { LOGS_ERROR_MESSAGES } from './logs.errors';
import { LiveLogsApi } from './live-logs.api';

const SCOPE = {
  org: randomBytes(9).toString('hex'),
  project: randomBytes(12).toString('hex'),
  environment: randomBytes(12).toString('hex'),
  deployment: randomBytes(12).toString('hex'),
};

function fakeStreamClient(outcome: () => Promise<void> = async () => undefined) {
  const calls: {
    req: EventStreamRequest;
    onFrame: (frame: StreamFrame) => void;
    signal?: AbortSignal;
    messages?: unknown;
  }[] = [];
  const client = {
    open: async (req: EventStreamRequest, onFrame: (frame: StreamFrame) => void, signal?: AbortSignal, messages?: unknown) => {
      calls.push({ req, onFrame, signal, messages });
      await outcome();
    },
  } as unknown as EventStreamClient;

  return { client, calls };
}

describe('LiveLogsApi', () => {
  it('T84: opens the live route under the deployment path, scoped by org and project, with the signal and the logs wording', async () => {
    const { client, calls } = fakeStreamClient();
    const stop = new AbortController();
    const frames: StreamFrame[] = [];

    await new LiveLogsApi(client).open(SCOPE, { onFrame: (frame) => frames.push(frame) }, stop.signal);

    expect(calls).toHaveLength(1);
    expect(calls[0].req).toEqual({
      path: `/projects/${SCOPE.project}/environments/${SCOPE.environment}/deployments/${SCOPE.deployment}/logs/live`,
      orgUid: SCOPE.org,
      projectUid: SCOPE.project,
    });
    expect(calls[0].signal).toBe(stop.signal);
    expect(calls[0].messages).toBe(LOGS_ERROR_MESSAGES);
    calls[0].onFrame({ event: undefined, data: 'x' });
    expect(frames).toEqual([{ event: undefined, data: 'x' }]);
  });

  it('T84: lets the failure of the stream through', async () => {
    const failure = new Error('stream failed');
    const { client } = fakeStreamClient(async () => {
      throw failure;
    });

    await expect(new LiveLogsApi(client).open(SCOPE, { onFrame: () => undefined }, new AbortController().signal)).rejects.toBe(
      failure,
    );
  });
});
