import { cliux } from '@contentstack/cli-utilities';

import { progressBarOf, silentProgress, terminalProgress, transferredOf } from './progress';

interface BarCall {
  call: string;
  value?: number;
  total?: number;
  payload?: Record<string, string>;
}

function fakeBars() {
  const built: Record<string, unknown>[] = [];
  const calls: BarCall[] = [];
  const bar = {
    start: (total: number, value: number, payload: Record<string, string>) => {
      calls.push({ call: 'start', total, value, payload });
    },
    update: (value: number, payload: Record<string, string>) => {
      calls.push({ call: 'update', value, payload });
    },
    stop: () => {
      calls.push({ call: 'stop' });
    },
  };
  jest.spyOn(cliux, 'progress').mockImplementation(((options: Record<string, unknown>) => {
    built.push(options);
    return bar;
  }) as never);

  return { built, calls };
}

const ONE_KB = 1024;
const ONE_MB = 1024 * 1024;

describe('transferredOf', () => {
  it('reads as done over total megabytes once the total reaches a megabyte', () => {
    expect(transferredOf(ONE_MB, 4 * ONE_MB)).toBe('1.0/4.0 MB');
  });

  it('reads in kilobytes on both sides when the total is under a megabyte', () => {
    expect(transferredOf(3 * ONE_KB, 12 * ONE_KB)).toBe('3/12 KB');
  });

  it('reads in bytes on both sides when the total is under a kilobyte', () => {
    expect(transferredOf(120, 480)).toBe('120/480 B');
  });

  it('picks the unit from the total, so the two sides never disagree', () => {
    expect(transferredOf(0, ONE_KB - 1)).toBe('0/1023 B');
    expect(transferredOf(0, ONE_KB)).toBe('0/1 KB');
    expect(transferredOf(0, ONE_MB - 1)).toBe('0/1024 KB');
    expect(transferredOf(0, ONE_MB)).toBe('0.0/1.0 MB');
  });
});

describe('progressBarOf', () => {
  it.each([
    [0, 0, 24],
    [0.5, 12, 12],
    [1, 24, 0],
  ])('colours the filled and empty halves apart at %p', (progress, filled, empty) => {
    const bar = progressBarOf(progress);

    expect(bar).toBe(
      `\u001b[36m${'\u2588'.repeat(filled)}\u001b[39m\u001b[2m${'\u2591'.repeat(empty)}\u001b[22m`,
    );
  });

  it('always draws the full width, however the fill rounds', () => {
    for (const progress of [0, 0.01, 0.37, 0.5, 0.99, 1]) {
      const glyphs = [...progressBarOf(progress)].filter((unit) => unit === '\u2588' || unit === '\u2591');

      expect(glyphs).toHaveLength(24);
    }
  });
});

describe('terminalProgress', () => {
  it('draws one bar, reports every advance against the total it started with, and stops it once', () => {
    const { built, calls } = fakeBars();
    const progress = terminalProgress('Uploading project.zip');

    progress.start(4 * ONE_MB);
    progress.start(9 * ONE_MB);
    progress.advance(ONE_MB);
    progress.advance(4 * ONE_MB);
    progress.stop();
    progress.stop();

    expect(built).toHaveLength(1);
    expect(calls).toEqual([
      { call: 'start', total: 4 * ONE_MB, value: 0, payload: { transferred: '0.0/4.0 MB' } },
      { call: 'update', value: ONE_MB, payload: { transferred: '1.0/4.0 MB' } },
      { call: 'update', value: 4 * ONE_MB, payload: { transferred: '4.0/4.0 MB' } },
      { call: 'stop' },
    ]);
  });

  it('draws a fresh bar after the previous one was stopped', () => {
    const { built, calls } = fakeBars();
    const progress = terminalProgress('Uploading project.zip');

    progress.start(ONE_MB);
    progress.stop();
    progress.start(2 * ONE_MB);
    progress.advance(ONE_MB);

    expect(built).toHaveLength(2);
    expect(calls.map((entry) => entry.call)).toEqual(['start', 'stop', 'start', 'update']);
    expect(calls[3].payload).toEqual({ transferred: '1.0/2.0 MB' });
  });

  it('draws nothing for an advance or a stop that arrives before the bar was started', () => {
    const { built, calls } = fakeBars();
    const progress = terminalProgress('Uploading project.zip');

    progress.advance(ONE_MB);
    progress.stop();

    expect(built).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('draws onto stdout, the stream whose terminal flag decided to draw at all', () => {
    const { built } = fakeBars();

    terminalProgress('Uploading project.zip').start(ONE_MB);

    expect(built[0].stream).toBe(process.stdout);
  });

  it('names the caller in the format and pads the percentage so the bar does not shift', () => {
    const { built } = fakeBars();

    terminalProgress('Uploading project.zip').start(ONE_MB);

    expect(built[0].format).toBe('Uploading project.zip  {bar}  {percentage}%  {transferred}');
    expect(built[0].formatBar).toBe(progressBarOf);
    expect(built[0].autopadding).toBe(true);
    expect(built[0].hideCursor).toBe(true);
    expect(built[0].gracefulExit).toBe(true);
  });
});

describe('silentProgress', () => {
  it('never draws a bar', () => {
    const { built, calls } = fakeBars();

    silentProgress.start(ONE_MB);
    silentProgress.advance(ONE_MB);
    silentProgress.stop();

    expect(built).toEqual([]);
    expect(calls).toEqual([]);
  });
});
