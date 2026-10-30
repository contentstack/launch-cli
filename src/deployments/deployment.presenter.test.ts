import { randomBytes } from 'node:crypto';

import {
  colouredLogMessage,
  firstDeploymentFailureMessage,
  deploymentLogLine,
  deploymentCancelQuestion,
  deploymentCancelledLine,
  deploymentColumns,
  deploymentNotCancelledLine,
  deploymentNotRolledBackLine,
  deploymentRollbackQuestion,
  rolledBackLine,
  deploymentDetailRows,
  deploymentVariablesSummary,
  deploymentUrlLine,
  deploymentUrlOf,
  wrapLogMessage,
} from './deployment.presenter';

const UID = randomBytes(12).toString('hex');
const HINT_SCOPE = '--org org1 --project proj1 --env env1';
const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

const ESCAPE = '\u001b';
const GREEN = '\u001b[38;2;34;139;34m';
const RESET = '\u001b[0m';

describe('deployment presenter', () => {
  it.each([
    [true, '\u001b[1mDeployment URL:\u001b[22m \u001b[36mhttps://site.example.test\u001b[39m'],
    [false, 'Deployment URL: https://site.example.test'],
  ])('labels the deployment url in bold and the url in cyan only on a terminal (terminal: %s)', (outputIsTTY, line) => {
    expect(deploymentUrlLine('https://site.example.test', outputIsTTY)).toBe(line);
  });

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
});

describe('firstDeploymentFailureMessage', () => {
  const ENVIRONMENT = { created: 'The environment "staging" (env9)', plural: false };
  const SCOPE = { org: 'org1', project: 'proj1', environmentUid: 'env9' };

  it('names the deployment, its status and the logs command for a failed deployment', () => {
    expect(firstDeploymentFailureMessage({ ...SCOPE, deploymentUid: 'dep1', status: 'FAILED' })).toBe(
      'Deployment "dep1" ended with status FAILED. ' +
        'Run csdx launch:logs:get --org org1 --project proj1 --env env9 --deployment dep1 to see the cause.',
    );
  });

  it('adds what survived a failure, in the singular', () => {
    expect(firstDeploymentFailureMessage({ ...ENVIRONMENT, ...SCOPE, deploymentUid: 'dep1', status: 'FAILED' })).toBe(
      'Deployment "dep1" ended with status FAILED. The environment "staging" (env9) was created. ' +
        'Run csdx launch:logs:get --org org1 --project proj1 --env env9 --deployment dep1 to see the cause.',
    );
  });

  it('agrees the verb with a plural survivor and leaves out the scope it does not know', () => {
    expect(
      firstDeploymentFailureMessage({
        created: 'The project "site" (p1) and its environment "Default"',
        plural: true,
        org: 'org1',
        project: 'p1',
        status: 'NONE',
        reason: 'Lookup refused.',
      }),
    ).toBe(
      'The deployment could not be followed to completion: Lookup refused. ' +
        'The project "site" (p1) and its environment "Default" were created. ' +
        'Run csdx launch:deployments:get --org org1 --project p1 to check its status.',
    );
  });

  it('words a deployment that could not be followed, with its uid', () => {
    expect(firstDeploymentFailureMessage({ ...SCOPE, deploymentUid: 'dep1', status: 'NONE', reason: 'Request timed out.' })).toBe(
      'Deployment "dep1" could not be followed to completion: Request timed out. ' +
        'Run csdx launch:deployments:get --org org1 --project proj1 --env env9 --deployment dep1 to check its status.',
    );
  });

  it('says no deployment was found when there is neither a uid nor a reason', () => {
    expect(firstDeploymentFailureMessage({ ...ENVIRONMENT, ...SCOPE, status: 'NONE' })).toBe(
      'No deployment was found to follow. The environment "staging" (env9) was created. ' +
        'Run csdx launch:deployments:list --org org1 --project proj1 --env env9 to check.',
    );
  });

  it.each([
    [false, 'The environment "staging" (env9) was created.'],
    [true, 'The environment "staging" (env9) were created.'],
  ])('words a wait that ran out as still in progress (plural %p)', (plural, created) => {
    expect(
      firstDeploymentFailureMessage({ ...ENVIRONMENT, plural, ...SCOPE, deploymentUid: 'dep1', status: 'DEPLOYING', timedOut: true }),
    ).toBe(
      'Deployment "dep1" was still DEPLOYING when the CLI stopped waiting. ' +
        `${created} ` +
        'Run csdx launch:deployments:get --org org1 --project proj1 --env env9 --deployment dep1 to check its status.',
    );
  });

  it('never mentions a rollback', () => {
    const message = firstDeploymentFailureMessage({ ...ENVIRONMENT, ...SCOPE, deploymentUid: 'dep1', status: 'FAILED' });

    expect(message).not.toMatch(/rolled back|roll back/i);
  });
});

const STATUSES = ['QUEUED', 'LIVE', 'DEPLOYED', 'ARCHIVED', 'DEPLOYING', 'SKIPPED', 'FAILED', 'CANCELLED', 'PROMOTING'];

function rowOf(rows: { field: string; value: string }[], field: string): string | undefined {
  return rows.find((row) => row.field === field)?.value;
}

function cellsOf(deployment: object, header: string): string {
  const column = deploymentColumns(true).find((candidate) => candidate.header === header);

  return column?.value(deployment) ?? 'no such column';
}

describe('deployment table presenter', () => {
  it.each(STATUSES)('writes the status %s verbatim in the list cell and the get row', (status) => {
    expect(cellsOf({ uid: UID, status }, 'STATUS')).toBe(status);
    expect(rowOf(deploymentDetailRows({ uid: UID, status }, true, SCOPE), 'STATUS')).toBe(status);
  });

  it.each([[undefined], [null], [''], ['   ']])('shows a dash for a status of %p', (status) => {
    expect(cellsOf({ uid: UID, status }, 'STATUS')).toBe('-');
    expect(rowOf(deploymentDetailRows({ uid: UID, status } as never, true, SCOPE), 'STATUS')).toBe('-');
  });

  it('labels the id DEPLOYMENT UID in the list and the get view, never a bare UID', () => {
    const headers = deploymentColumns(true).map((column) => column.header);
    const fields = deploymentDetailRows({ uid: UID }, true, SCOPE).map((row) => row.field);

    expect(headers[0]).toBe('DEPLOYMENT UID');
    expect(fields[0]).toBe('DEPLOYMENT UID');
    expect([...headers, ...fields]).not.toContain('UID');
  });

  it('shows the git columns and rows for a git project and none of them for a file-upload project', () => {
    const deployment = { uid: UID, gitBranch: 'main', commitHash: 'abcdef0123456789', commitMessage: 'Ship it' };
    const gitHeaders = deploymentColumns(true).map((column) => column.header);
    const plainHeaders = deploymentColumns(false).map((column) => column.header);
    const gitRows = deploymentDetailRows(deployment, true, SCOPE);
    const plainRows = deploymentDetailRows(deployment, false, SCOPE);

    expect(gitHeaders).toEqual(['DEPLOYMENT UID', 'STATUS', 'COMMIT', 'UPDATED', 'BRANCH']);
    expect(plainHeaders).toEqual(['DEPLOYMENT UID', 'STATUS', 'UPDATED']);
    expect(rowOf(gitRows, 'BRANCH')).toBe('main');
    expect(rowOf(gitRows, 'COMMIT')).toBe('abcdef0123456789');
    expect(rowOf(gitRows, 'COMMIT MESSAGE')).toBe('Ship it');
    expect(plainRows.map((row) => row.field)).not.toContain('BRANCH');
    expect(plainRows.map((row) => row.field)).not.toContain('COMMIT');
    expect(plainRows.map((row) => row.field)).not.toContain('COMMIT MESSAGE');
  });

  it('shortens the commit in the list to seven characters and leaves a shorter value whole', () => {
    expect(cellsOf({ uid: UID, commitHash: 'abcdef0123456789' }, 'COMMIT')).toBe('abcdef0');
    expect(cellsOf({ uid: UID, commitHash: 'abcdefg' }, 'COMMIT')).toBe('abcdefg');
    expect(cellsOf({ uid: UID, commitHash: 'abc' }, 'COMMIT')).toBe('abc');
    expect(cellsOf({ uid: UID }, 'COMMIT')).toBe('-');
  });

  it('counts environment variables without showing a key or a value and points at variables:list', () => {
    const keys = [0, 1, 2].map(() => randomBytes(6).toString('hex'));
    const values = [0, 1, 2].map(() => randomBytes(6).toString('hex'));
    const deployment = {
      uid: UID,
      environmentVariables: keys.map((key, index) => ({ key, value: values[index] })),
    };

    const rows = deploymentDetailRows(deployment, true, SCOPE);
    const shown = JSON.stringify(rows);

    expect(rowOf(rows, 'ENVIRONMENT VARIABLES')).toBe(`3 (list them with csdx launch:variables:list ${HINT_SCOPE})`);
    for (const secret of [...keys, ...values]) {
      expect(shown).not.toContain(secret);
    }
  });

  it.each([[null], [[]], [undefined]])('counts %p environment variables as 0 without throwing', (variables) => {
    const deployment = { uid: UID, environmentVariables: variables } as never;

    expect(deploymentVariablesSummary(deployment, SCOPE)).toBe(`0 (list them with csdx launch:variables:list ${HINT_SCOPE})`);
    expect(() => deploymentDetailRows(deployment, true, SCOPE)).not.toThrow();
  });

  it('shows no build logs row, because the API has no build logs field and the logs command is not a deployment view', () => {
    const fields = deploymentDetailRows({ uid: 'dep9' }, true, SCOPE).map((row) => row.field);

    expect(fields).toEqual([
      'DEPLOYMENT UID',
      'STATUS',
      'BRANCH',
      'COMMIT',
      'COMMIT MESSAGE',
      'URL',
      'ENVIRONMENT VARIABLES',
      'CREATED AT',
      'UPDATED AT',
    ]);
    expect(JSON.stringify(deploymentDetailRows({ uid: 'dep9' }, true, SCOPE))).not.toContain('launch:logs:get');
  });

  it.each([
    ['a subject and a trailer', 'Ship it\n\nCo-Authored-By: Claude <[noreply@anthropic.com](mailto:noreply@anthropic.com)>', 'Ship it'],
    ['windows line endings', 'Ship it\r\nbody', 'Ship it'],
    ['a leading blank line', '\n\n  Ship it  \nbody', 'Ship it'],
    ['a tab inside the subject', 'Ship\tit', 'Ship it'],
    ['only whitespace', ' \n\t\n ', '-'],
    ['an empty message', '', '-'],
  ])('shows only the first line of a commit message holding %s', (_label, message, expected) => {
    const rows = deploymentDetailRows({ uid: UID, commitMessage: message }, true, SCOPE);

    expect(rowOf(rows, 'COMMIT MESSAGE')).toBe(expected);
  });

  it('truncates a long commit subject to seventy-two characters with an ellipsis and leaves seventy-two whole', () => {
    const exact = 'x'.repeat(72);
    const over = 'x'.repeat(73);

    expect(rowOf(deploymentDetailRows({ uid: UID, commitMessage: exact }, true, SCOPE), 'COMMIT MESSAGE')).toBe(exact);
    expect(rowOf(deploymentDetailRows({ uid: UID, commitMessage: over }, true, SCOPE), 'COMMIT MESSAGE')).toBe(
      `${'x'.repeat(71)}\u2026`,
    );
  });

  it('shows a dash for a field made only of control characters', () => {
    expect(rowOf(deploymentDetailRows({ uid: UID, gitBranch: '\u0007\u001b[31m' }, true, SCOPE), 'BRANCH')).toBe('-');
  });

  it('never lets a control character or a line break into any cell of the list or the get view', () => {
    const hostile = 'a\nb\rc\td\u001b[31me\u0007f\u0085g';
    const deployment = {
      uid: hostile,
      status: hostile,
      commitHash: hostile,
      commitMessage: hostile,
      gitBranch: hostile,
      deploymentUrl: hostile,
      createdAt: hostile,
      updatedAt: hostile,
    };
    const cells = [
      ...deploymentColumns(true).map((column) => column.value(deployment)),
      ...deploymentDetailRows(deployment, true, SCOPE).flatMap((row) => [row.field, row.value]),
    ];

    for (const cell of cells) {
      expect(cell).not.toMatch(/\p{Cc}/u);
    }
  });

  it('falls back to a dash for every absent field and prefers the deployment url over the preview url', () => {
    const rows = deploymentDetailRows({ uid: UID }, true, SCOPE);

    for (const field of ['BRANCH', 'COMMIT', 'COMMIT MESSAGE', 'URL', 'CREATED AT', 'UPDATED AT']) {
      expect(rowOf(rows, field)).toBe('-');
    }

    expect(
      rowOf(deploymentDetailRows({ uid: UID, deploymentUrl: 'a.example.test', previewUrl: 'b.example.test' }, true, SCOPE), 'URL'),
    ).toBe('https://a.example.test');
  });
});

describe('rollback and cancel wording', () => {
  it('words the confirm questions with the deployment uid', () => {
    expect(deploymentRollbackQuestion(UID)).toBe(`Are you sure you want to roll back this environment to deployment "${UID}"?`);
    expect(deploymentCancelQuestion(UID)).toBe(`Are you sure you want to cancel deployment "${UID}"?`);
  });

  it('prints the success lines in green on a terminal and as exact plain text otherwise', () => {
    expect(rolledBackLine(UID, true)).toBe(`\u001b[32m✔ Environment rolled back to deployment "${UID}" successfully.\u001b[39m`);
    expect(rolledBackLine(UID, false)).toBe(`✔ Environment rolled back to deployment "${UID}" successfully.`);
    expect(deploymentCancelledLine(UID, true)).toBe(`\u001b[32m✔ Deployment "${UID}" cancelled successfully.\u001b[39m`);
    expect(deploymentCancelledLine(UID, false)).toBe(`✔ Deployment "${UID}" cancelled successfully.`);
  });

  it('prints the decline lines in yellow on a terminal and plain otherwise', () => {
    expect(deploymentNotRolledBackLine(true)).toBe('\u001b[33mEnvironment not rolled back.\u001b[39m');
    expect(deploymentNotRolledBackLine(false)).toBe('Environment not rolled back.');
    expect(deploymentNotCancelledLine(true)).toBe('\u001b[33mDeployment not cancelled.\u001b[39m');
    expect(deploymentNotCancelledLine(false)).toBe('Deployment not cancelled.');
  });
});
