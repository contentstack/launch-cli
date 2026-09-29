import { randomBytes } from 'node:crypto';

import {
  colouredLogMessage,
  deploymentLogLine,
  deploymentLogsUnavailableLine,
  deploymentUrlOf,
  wrapLogMessage,
} from './deployment.presenter';

const UID = randomBytes(12).toString('hex');

const ESCAPE = '\u001b';
const GREEN = '\u001b[38;2;34;139;34m';
const RESET = '\u001b[0m';

describe('deployment presenter', () => {
  it('leaves an absolute deployment url alone and gives a bare host a scheme', () => {
    expect(deploymentUrlOf({ uid: UID, deploymentUrl: 'https://site.example.test' })).toBe('https://site.example.test');
    expect(deploymentUrlOf({ uid: UID, deploymentUrl: 'site.example.test' })).toBe('https://site.example.test');
  });

  it('falls back to the preview url and reports nothing when neither is usable', () => {
    expect(deploymentUrlOf({ uid: UID, previewUrl: 'preview.example.test' })).toBe('https://preview.example.test');
    expect(deploymentUrlOf({ uid: UID })).toBeUndefined();
    expect(deploymentUrlOf({ uid: UID, deploymentUrl: '', previewUrl: '' })).toBeUndefined();
  });

  it.each([
    [{ message: 'Build started' }, 'Build started'],
    [{ message: 'Build started', timestamp: '' }, 'Build started'],
    [{ message: 'Build started', timestamp: 'not a time' }, 'Build started'],
    [{ timestamp: '2026-09-25T10:00:03.000Z' }, '2026-09-25 10:00:03.000:'],
    [{ message: '', timestamp: '2026-09-25T10:00:03.000Z' }, '2026-09-25 10:00:03.000:'],
    [{}, ''],
  ])('renders the log %j off a terminal as %j rather than crashing or printing undefined', (log, line) => {
    expect(deploymentLogLine(log, false)).toBe(line);
  });

  it.each([
    [{ message: 'Build started' }, 'Build started'],
    [{ message: 'Build started', timestamp: 'not a time' }, 'Build started'],
    [{ timestamp: '2026-09-25T10:00:03.000Z' }, '\u001b[2m10:00:03\u001b[22m'],
    [{ message: '', timestamp: '2026-09-25T10:00:03.000Z' }, '\u001b[2m10:00:03\u001b[22m'],
    [{}, ''],
  ])('renders the log %j on a terminal as %j', (log, line) => {
    expect(deploymentLogLine(log, true)).toBe(line);
  });

  it('dims a zero-padded local clock on a terminal and keeps the full utc stamp off one', () => {
    const log = { message: 'Cloning repository...', timestamp: '2026-09-25T04:07:09.120Z' };

    expect(deploymentLogLine(log, true)).toBe('\u001b[2m04:07:09\u001b[22m  Cloning repository...');
    expect(deploymentLogLine(log, false)).toBe('2026-09-25 04:07:09.120:  Cloning repository...');
  });

  it('keeps the colours the deployment agent sends on a terminal and drops them off one', () => {
    const message = `${GREEN}—— Step 3: Building your app ——${RESET}`;
    const log = { message, timestamp: '2026-09-25T10:00:03.000Z' };

    expect(deploymentLogLine(log, true)).toBe(`\u001b[2m10:00:03\u001b[22m  ${message}`);
    expect(deploymentLogLine(log, false)).toBe('2026-09-25 10:00:03.000:  —— Step 3: Building your app ——');
  });

  it.each([
    ['\u001b[31mBuild failed:\u001b[0m here', '\u001b[31mBuild failed:\u001b[0m here'],
    ['\u001b[1m\u001b[38;2;30;144;255mResponse Mode\u001b[22m', '\u001b[1m\u001b[38;2;30;144;255mResponse Mode\u001b[22m'],
    ['\u009b32mwide colour\u009b0m', '\u009b32mwide colour\u009b0m'],
    ['progress\u001b[2Koverwritten', 'progressoverwritten'],
    ['up\u001b[1Aand\u001b[3Dback', 'upandback'],
    ['hide\u001b[?25lcursor\u001b[?25h', 'hidecursor'],
    ['title\u001b]0;a new tab title\u0007set', 'titleset'],
    ['title\u001b]0;via string terminator\u001b\\set', 'titleset'],
    ['unterminated\u001b]0;osc to the end', 'unterminated'],
    ['reset\u001bcstate', 'resetstate'],
    ['bar 40%\rbar 80%', 'bar 40%bar 80%'],
    ['keeps\r\nthe newline', 'keeps\r\nthe newline'],
    ['bell\u0007back\bspace', 'bellbackspace'],
    ['nothing to strip', 'nothing to strip'],
  ])('reduces %j to %j so only colour survives into the terminal', (message, kept) => {
    expect(colouredLogMessage(message)).toBe(kept);
  });

  it.each([
    ['npm warn deprecated dinero', 12, ['npm warn', 'deprecated', 'dinero']],
    ['exactly twelve', 14, ['exactly twelve']],
    ['supercalifragilistic word', 10, ['supercalif', 'ragilistic', 'word']],
    ['trailing  spaces go', 10, ['trailing', 'spaces go']],
    ['', 10, ['']],
    ['keeps one', 80, ['keeps one']],
  ])('wraps %j at width %i into %j, breaking on a space when there is one', (message, width, rows) => {
    expect(wrapLogMessage(message, width)).toEqual(rows);
  });

  it('counts only printable characters when wrapping, never the colour codes', () => {
    const rows = wrapLogMessage('\u001b[31mred words here\u001b[39m again', 10);

    expect(rows).toEqual(['\u001b[31mred words', 'here\u001b[39m again']);
    expect(rows.map((row) => row.split(ESCAPE).join('').replace(/\[[0-9;:]*m/g, '').length)).toEqual([9, 10]);
  });

  it('hangs a wrapped log under the message column so nothing sits beneath the clock', () => {
    const log = {
      message: 'npm warn deprecated @dinero.js/core@2.0.0-alpha.8: consolidated into dinero.js',
      timestamp: '2026-09-25T10:00:03.000Z',
    };

    expect(deploymentLogLine(log, true, 50)).toBe(
      '\u001b[2m10:00:03\u001b[22m  npm warn deprecated\n' +
        '          @dinero.js/core@2.0.0-alpha.8:\n' +
        '          consolidated into dinero.js',
    );
  });

  it.each([
    [undefined, '\u001b[2m10:00:03\u001b[22m  a message that is well past any narrow terminal'],
    [20, '\u001b[2m10:00:03\u001b[22m  a message that is well past any narrow terminal'],
    [33, '\u001b[2m10:00:03\u001b[22m  a message that is well past any narrow terminal'],
    [34, '\u001b[2m10:00:03\u001b[22m  a message that is well\n          past any narrow terminal'],
  ])('wraps only once the terminal is wide enough to be worth it (columns: %s)', (columns, line) => {
    const log = { message: 'a message that is well past any narrow terminal', timestamp: '2026-09-25T10:00:03.000Z' };

    expect(deploymentLogLine(log, true, columns)).toBe(line);
  });

  it('never wraps when the output is not a terminal, however wide the terminal claims to be', () => {
    const log = { message: 'a message that is well past any narrow terminal', timestamp: '2026-09-25T10:00:03.000Z' };

    expect(deploymentLogLine(log, false, 30)).toBe(
      '2026-09-25 10:00:03.000:  a message that is well past any narrow terminal',
    );
  });

  it('names what failed when a log fetch rejects with something other than an Error', () => {
    expect(deploymentLogsUnavailableLine('socket hang up')).toBe(
      '  ! Could not read the deployment logs (socket hang up). Still waiting on the deployment.',
    );
  });
});
