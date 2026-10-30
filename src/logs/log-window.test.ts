import { UsageError } from '../core/errors';
import { parseLogWindow } from './log-window';

const NOW = Date.UTC(2025, 5, 15, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIXED = '--since and --until must both be relative (like 12hr) or both absolute (ISO 8601) timestamps.';
const clock = () => NOW;

function failureOf(window: { since?: string | null; until?: string | null }): UsageError {
  try {
    parseLogWindow(window, clock);
  } catch (error) {
    return error as UsageError;
  }

  throw new Error('parseLogWindow did not throw');
}

describe('parseLogWindow', () => {
  it.each([
    ['45s', 45_000],
    ['30m', 30 * 60_000],
    ['30min', 30 * 60_000],
    ['2h', 2 * HOUR],
    ['12hr', 12 * HOUR],
    ['2d', 2 * DAY],
    ['12HR', 12 * HOUR],
    ['30MIN', 30 * 60_000],
    [' 5m ', 5 * 60_000],
  ])('reads a relative since of %s from the one clock reading and ends the window at now', (since, offset) => {
    const window = parseLogWindow({ since }, clock);

    expect(window.startTime).toBe(NOW - offset);
    expect(window.endTime).toBe(NOW);
  });

  it('reads an absolute timestamp literally whatever the local time zone, across a daylight saving change', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';

    try {
      const march = () => Date.UTC(2025, 2, 9, 18, 0);
      const offset = parseLogWindow(
        { since: '2025-03-09T01:30:00-05:00', until: '2025-03-09T12:00:00-04:00' },
        march,
      );
      const zulu = parseLogWindow({ since: '2025-03-09T06:30:00Z', until: '2025-03-09T16:00:00Z' }, march);
      const india = parseLogWindow({ since: '2025-03-09T12:00:00+05:30', until: '2025-03-09T21:30:00+05:30' }, march);

      expect(offset).toEqual({ startTime: Date.UTC(2025, 2, 9, 6, 30), endTime: Date.UTC(2025, 2, 9, 16, 0) });
      expect(zulu).toEqual(offset);
      expect(india).toEqual({ startTime: Date.UTC(2025, 2, 9, 6, 30), endTime: Date.UTC(2025, 2, 9, 16, 0) });
    } finally {
      if (original === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = original;
      }
    }
  });

  it('accepts optional seconds and fractional seconds in an absolute timestamp', () => {
    const minutes = parseLogWindow({ since: '2025-06-15T10:00Z', until: '2025-06-15T11:00:00.250Z' }, clock);

    expect(minutes).toEqual({ startTime: Date.UTC(2025, 5, 15, 10, 0), endTime: Date.UTC(2025, 5, 15, 11, 0, 0, 250) });
  });

  it.each([
    ['2025-06-15'],
    ['2025-06-15T10:00:00'],
    ['2025-06-15 10:00:00Z'],
    ['2025-06-15T10:00:00+0530'],
    ['2025-02-31T10:00:00Z'],
    ['2025-13-01T10:00:00Z'],
    ['2025-06-15T24:00:00Z'],
    ['2025-06-15T10:60:00Z'],
    ['2025-06-15T10:00:60Z'],
    ['2025-06-15T10:00:00+24:00'],
    ['2025-06-15T10:00:00+05:60'],
  ])('refuses the timestamp %s naming the flag and both formats', (since) => {
    const failure = failureOf({ since });

    expect(failure).toBeInstanceOf(UsageError);
    expect(failure.exitCode).toBe(2);
    expect(failure.message).toBe(
      `--since must be a relative time like 12hr (units s, m, h, d) or an ISO 8601 timestamp with an offset like 2025-01-15T10:00:00Z; "${since}" is not.`,
    );
  });

  it.each([
    [{ since: '2025-06-15T10:00:00Z', until: '12h' }],
    [{ since: '12h', until: '2025-06-15T10:00:00Z' }],
  ])('refuses a pair that mixes relative and absolute with the exact message for %j', (window) => {
    const failure = failureOf(window);

    expect(failure).toBeInstanceOf(UsageError);
    expect(failure.exitCode).toBe(2);
    expect(failure.message).toBe(MIXED);
  });

  it.each([['yesterday'], ['12'], ['-5m'], ['5w'], ['1.5h'], ['30 m'], ['0h'], ['00m'], ['h'], ['5 '.repeat(2)]])(
    'refuses the relative value %p naming --since',
    (since) => {
      const failure = failureOf({ since });

      expect(failure.exitCode).toBe(2);
      expect(failure.message).toContain('--since must be a relative time like 12hr');
      expect(failure.message).toContain('ISO 8601');
      expect(failure.message).toContain(`"${since}" is not.`);
    },
  );

  it('names --until when it is the bad one, even beside a valid since', () => {
    const failure = failureOf({ since: '1h', until: 'yesterday' });

    expect(failure.message).toContain('--until must be a relative time like 12hr');
    expect(failure.message).toContain('"yesterday" is not.');
  });

  it('refuses an amount too large to be a time', () => {
    const failure = failureOf({ since: `${'9'.repeat(20)}d` });

    expect(failure.message).toContain('--since must be a relative time like 12hr');
  });

  it('accepts since equal to until and refuses since one millisecond after it', () => {
    const same = parseLogWindow({ since: '2025-06-15T10:00:00.000Z', until: '2025-06-15T10:00:00.000Z' }, clock);
    const failure = failureOf({ since: '2025-06-15T10:00:00.001Z', until: '2025-06-15T10:00:00.000Z' });

    expect(same.startTime).toBe(same.endTime);
    expect(failure).toBeInstanceOf(UsageError);
    expect(failure.exitCode).toBe(2);
    expect(failure.message).toBe('--since must not be later than --until.');
  });

  it('refuses a relative since that lies after a relative until', () => {
    expect(failureOf({ since: '1h', until: '2h' }).message).toBe('--since must not be later than --until.');
    expect(parseLogWindow({ since: '2h', until: '1h' }, clock)).toEqual({ startTime: NOW - 2 * HOUR, endTime: NOW - HOUR });
  });

  it('defaults to the hour ending now', () => {
    expect(parseLogWindow({}, clock)).toEqual({ startTime: NOW - HOUR, endTime: NOW });
  });

  it('takes the default hour from the supplied until and the default until from now, never as a mixed pair', () => {
    const onlyUntil = parseLogWindow({ until: '30m' }, clock);
    const onlyAbsoluteUntil = parseLogWindow({ until: '2025-06-15T10:00:00Z' }, clock);
    const onlyAbsoluteSince = parseLogWindow({ since: '2025-06-15T10:00:00Z' }, clock);
    const onlyRelativeSince = parseLogWindow({ since: '3h' }, clock);

    expect(onlyUntil).toEqual({ startTime: NOW - 30 * 60_000 - HOUR, endTime: NOW - 30 * 60_000 });
    expect(onlyAbsoluteUntil).toEqual({
      startTime: Date.UTC(2025, 5, 15, 9, 0),
      endTime: Date.UTC(2025, 5, 15, 10, 0),
    });
    expect(onlyAbsoluteSince).toEqual({ startTime: Date.UTC(2025, 5, 15, 10, 0), endTime: NOW });
    expect(onlyRelativeSince).toEqual({ startTime: NOW - 3 * HOUR, endTime: NOW });
  });

  it.each([[undefined], [null], [''], ['   ']])('treats %p for either flag as absent', (blank) => {
    expect(parseLogWindow({ since: blank, until: blank }, clock)).toEqual({ startTime: NOW - HOUR, endTime: NOW });
    expect(parseLogWindow({ since: '2h', until: blank }, clock)).toEqual({ startTime: NOW - 2 * HOUR, endTime: NOW });
    expect(parseLogWindow({ since: blank, until: '2025-06-15T10:00:00Z' }, clock)).toEqual({
      startTime: Date.UTC(2025, 5, 15, 9, 0),
      endTime: Date.UTC(2025, 5, 15, 10, 0),
    });
  });

  it('reads the clock exactly once even when it advances on every call', () => {
    let calls = 0;
    const advancing = () => {
      calls += 1;

      return NOW + calls * 1000;
    };

    const window = parseLogWindow({ since: '2h', until: '1h' }, advancing);

    expect(calls).toBe(1);
    expect(window).toEqual({ startTime: NOW + 1000 - 2 * HOUR, endTime: NOW + 1000 - HOUR });
  });

  it('reads the clock once for the default window too', () => {
    let calls = 0;

    parseLogWindow({}, () => {
      calls += 1;

      return NOW;
    });

    expect(calls).toBe(1);
  });

  it('reports no clamp at exactly 24 hours and a clamp from now minus 24 hours one millisecond past it', () => {
    const atLimit = parseLogWindow({ since: '24h' }, clock);
    const absoluteAtLimit = parseLogWindow({ since: new Date(NOW - DAY).toISOString(), until: '2025-06-15T11:00:00Z' }, clock);
    const pastLimit = parseLogWindow({ since: new Date(NOW - DAY - 1).toISOString(), until: '2025-06-15T11:00:00Z' }, clock);
    const twoDays = parseLogWindow({ since: '2d' }, clock);

    expect(atLimit).toEqual({ startTime: NOW - DAY, endTime: NOW });
    expect('clampedFrom' in atLimit).toBe(false);
    expect('clampedFrom' in absoluteAtLimit).toBe(false);
    expect(pastLimit.startTime).toBe(NOW - DAY - 1);
    expect(pastLimit.clampedFrom).toBe(NOW - DAY);
    expect(twoDays).toEqual({ startTime: NOW - 2 * DAY, endTime: NOW, clampedFrom: NOW - DAY });
  });
});
