import { DEPLOYMENT_LOGS_FROM, LogTail } from './deployment.log-tail';
import type { DeploymentLog } from './types';

describe('log tail', () => {
  it('asks for every log before it has seen any', () => {
    expect(new LogTail().since()).toBe(DEPLOYMENT_LOGS_FROM);
  });

  it('hands back every log the first time it sees them', () => {
    const tail = new LogTail();
    const logs = [log('one', '2026-09-25T10:00:00.123Z'), log('two', '2026-09-25T10:00:01.456Z')];

    expect(tail.fresh(logs)).toEqual(logs);
  });

  it('asks from one millisecond before the last line it handed back', () => {
    const tail = new LogTail();

    tail.fresh([log('one', '2026-09-25T10:00:00.123Z'), log('two', '2026-09-25T10:00:01.456Z')]);

    expect(tail.since()).toBe('2026-09-25T10:00:01.455Z');
  });

  it.each([[undefined], [''], ['not a time']])('keeps its place past a line with the timestamp %j', (timestamp) => {
    const tail = new LogTail();
    const logs = [log('one', '2026-09-25T10:00:00.123Z'), log('two', timestamp)];

    expect(tail.fresh(logs)).toEqual(logs);
    expect(tail.since()).toBe('2026-09-25T10:00:00.122Z');
  });

  it('skips the lines it already handed back at the last millisecond but not a new one sharing it', () => {
    const tail = new LogTail();
    tail.fresh([log('one', '2026-09-25T10:00:00.123Z'), log('two', '2026-09-25T10:00:00.123Z')]);

    const next = tail.fresh([
      log('one', '2026-09-25T10:00:00.123Z'),
      log('two', '2026-09-25T10:00:00.123Z'),
      log('three', '2026-09-25T10:00:00.123Z'),
      log('four', '2026-09-25T10:00:00.500Z'),
    ]);

    expect(next.map((entry) => entry.message)).toEqual(['three', 'four']);
  });

  it('hands back the extra copies when more of a repeated line arrive at the last millisecond', () => {
    const tail = new LogTail();
    const retrying = log('retrying', '2026-09-25T10:00:00.123Z');
    tail.fresh([retrying, retrying]);

    expect(tail.fresh([retrying, retrying, retrying])).toEqual([retrying]);
  });

  it('treats the same message from another stage as a different line', () => {
    const tail = new LogTail();
    tail.fresh([{ ...log('done', '2026-09-25T10:00:00.123Z'), stage: 'Build' }]);

    const next = tail.fresh([
      { ...log('done', '2026-09-25T10:00:00.123Z'), stage: 'Build' },
      { ...log('done', '2026-09-25T10:00:00.123Z'), stage: 'Deploy' },
    ]);

    expect(next.map((entry) => entry.stage)).toEqual(['Deploy']);
  });
});

function log(message: string, timestamp?: string): DeploymentLog {
  return { message, timestamp };
}
