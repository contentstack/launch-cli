import {
  deploymentStatusLine,
  liveSessionEndedLine,
  liveSessionLine,
  liveStreamLostMessage,
  noLiveLinesLine,
  logsWaitTimedOutMessage,
  noDeploymentLogsLine,
  noServerLogsLine,
  serverLogLine,
  serverLogsCapLine,
  serverLogsRetentionLine,
  stoppedFollowingLine,
} from './logs.presenter';

const YELLOW_OPEN = '\u001b[33m';
const YELLOW_CLOSE = '\u001b[39m';

function yellow(text: string): string {
  return `${YELLOW_OPEN}${text}${YELLOW_CLOSE}`;
}

describe('logs presenter', () => {
  it('words the empty deployment result in yellow on a terminal and plain on a pipe', () => {
    expect(noDeploymentLogsLine('d1', true)).toBe(yellow('No deployment logs found for deployment d1.'));
    expect(noDeploymentLogsLine('d1', false)).toBe('No deployment logs found for deployment d1.');
  });

  it('names the resolved window in ISO UTC for the empty server result', () => {
    const start = Date.parse('2026-10-28T09:00:00.000Z');
    const end = Date.parse('2026-10-28T10:00:00.500Z');

    expect(noServerLogsLine(start, end, false)).toBe(
      'No server logs found between 2026-10-28T09:00:00.000Z and 2026-10-28T10:00:00.500Z.',
    );
    expect(noServerLogsLine(start, end, true)).toBe(
      yellow('No server logs found between 2026-10-28T09:00:00.000Z and 2026-10-28T10:00:00.500Z.'),
    );
  });

  it('words the 5000-line notice exactly', () => {
    expect(serverLogsCapLine(false)).toBe(
      'Showing the newest 5000 server log lines in this window. Narrow --since/--until to see earlier ones.',
    );
    expect(serverLogsCapLine(true)).toBe(yellow(serverLogsCapLine(false)));
  });

  it('words the 24 hour notice from the clamped start', () => {
    const from = Date.parse('2026-10-27T10:00:00.000Z');

    expect(serverLogsRetentionLine(from, false)).toBe(
      'Server logs are kept for 24 hours; showing from 2026-10-27T10:00:00.000Z.',
    );
    expect(serverLogsRetentionLine(from, true)).toBe(yellow(serverLogsRetentionLine(from, false)));
  });

  it('words the interrupt line in yellow on a terminal and plain on a pipe', () => {
    expect(stoppedFollowingLine(true)).toBe(yellow('Stopped following the logs.'));
    expect(stoppedFollowingLine(false)).toBe('Stopped following the logs.');
  });

  it.each([
    [{ deploymentNumber: 7 }, 'LIVE', 'Deployment #7 is LIVE.'],
    [{ deploymentNumber: 0 }, 'FAILED', 'Deployment #0 is FAILED.'],
    [{}, 'LIVE', 'Deployment is LIVE.'],
    [{ deploymentNumber: null as unknown as number }, 'CANCELLED', 'Deployment is CANCELLED.'],
    [{ deploymentNumber: 3 }, 'UNKNOWN', 'Deployment #3 is UNKNOWN.'],
  ])('words the status line for %j and %s', (deployment, status, line) => {
    expect(deploymentStatusLine(deployment, status)).toBe(line);
  });

  it('words the timed-out message with the full scope and the status', () => {
    expect(
      logsWaitTimedOutMessage('DEPLOYING', { org: 'o1', project: 'p1', environment: 'e1' }, 'd1'),
    ).toBe(
      'Stopped waiting after 20 minutes; the deployment was still DEPLOYING. ' +
        'Run csdx launch:logs:get --org o1 --project p1 --env e1 --deployment d1 again to keep following it.',
    );
  });

  it('renders a server entry like a deployment log line', () => {
    expect(serverLogLine({ timestamp: '2026-10-28T10:00:00.250Z', message: 'hello', source: 'edge' }, false)).toBe(
      '2026-10-28 10:00:00.250:  hello',
    );
  });

  it('renders an epoch millisecond timestamp through the same format', () => {
    expect(serverLogLine({ timestamp: Date.parse('2026-10-28T10:00:00.250Z'), message: 'hello' }, false)).toBe(
      '2026-10-28 10:00:00.250:  hello',
    );
  });

  it('drops the colour of a server message on a pipe and keeps it on a terminal', () => {
    const message = '\u001b[31mboom\u001b[0m';

    expect(serverLogLine({ timestamp: '2026-10-28T10:00:00.000Z', message }, false)).toBe(
      '2026-10-28 10:00:00.000:  boom',
    );
    expect(serverLogLine({ timestamp: '2026-10-28T10:00:00.000Z', message }, true, 200)).toContain(message);
  });

  it.each([
    [{}, ''],
    [{ message: 'only a message' }, 'only a message'],
    [{ timestamp: '2026-10-28T10:00:00.000Z' }, '2026-10-28 10:00:00.000:'],
    [{ timestamp: Number.NaN, message: 'nan' }, 'nan'],
    [{ timestamp: Number.POSITIVE_INFINITY, message: 'inf' }, 'inf'],
    [{ timestamp: 9e15, message: 'beyond the date range' }, 'beyond the date range'],
    [{ timestamp: 'not a time', message: 'bad' }, 'bad'],
    [{ timestamp: null as unknown as string, message: null as unknown as string }, ''],
    [{ message: 42 as unknown as string }, ''],
    [null as unknown as object, ''],
    ['text' as unknown as object, ''],
  ])('prints a fallback for the server entry %j', (log, line) => {
    expect(serverLogLine(log, false)).toBe(line);
  });

  it('T86: words the live session end in the local clock, dimmed on a terminal', () => {
    const endsAt = new Date(2026, 9, 28, 14, 5, 9).getTime();

    expect(liveSessionLine(endsAt, false)).toBe('Live session ends at 14:05:09; press Ctrl-C to stop.');
    expect(liveSessionLine(endsAt, true)).toBe('\u001b[2mLive session ends at 14:05:09; press Ctrl-C to stop.\u001b[22m');
  });

  it('T88: words the server-limit end of a live session exactly', () => {
    expect(liveSessionEndedLine()).toBe('The live session ended (server limit). Run the command again to keep following.');
  });

  it('words the live session that printed nothing in yellow on a terminal and plain on a pipe', () => {
    expect(noLiveLinesLine(false)).toBe('No live server logs arrived during this session.');
    expect(noLiveLinesLine(true)).toBe(yellow('No live server logs arrived during this session.'));
  });

  it('T90: words the lost live stream with the number of attempts', () => {
    expect(liveStreamLostMessage(3)).toBe(
      'Lost the connection to the live server logs after 3 attempts. Check your network connection and run the command again.',
    );
  });
});
