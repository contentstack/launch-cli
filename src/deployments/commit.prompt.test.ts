import { randomBytes } from 'node:crypto';

import { CancelledError, UsageError } from '../core/errors';

import { LaunchApiError } from '../transport/errors';
import { commitChoice, promptForCommit } from './commit.prompt';
import type { Commit } from '../environments/types';

const SCOPE = {
  org: randomBytes(9).toString('hex'),
  project: randomBytes(12).toString('hex'),
  environment: randomBytes(12).toString('hex'),
};

function harness(commits: Commit[] | Error, answer: unknown = undefined, isTTY = true) {
  const scopes: unknown[] = [];
  const payloads: Record<string, unknown>[] = [];
  const deps = {
    isTTY,
    api: {
      environments: {
        commits: async (scope: unknown) => {
          scopes.push(scope);
          if (commits instanceof Error) {
            throw commits;
          }
          return commits;
        },
      },
    },
    ux: {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        payloads.push(payload as Record<string, unknown>);
        return answer as never;
      },
    },
  } as unknown as Parameters<typeof promptForCommit>[0];

  return { deps, scopes, payloads };
}

describe('promptForCommit', () => {
  it('lists short hash and subject, returns the full sha of the answer and reads with the full scope', async () => {
    const sha = randomBytes(20).toString('hex');
    const { deps, scopes, payloads } = harness([{ sha, shortSha: 'abc1234', message: 'fix it\nlong body' }], sha);

    const chosen = await promptForCommit(deps, SCOPE);

    expect(chosen).toBe(sha);
    expect(scopes).toEqual([SCOPE]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ type: 'list', choices: [{ name: 'abc1234  fix it', value: sha }] });
  });

  it.each([
    ['an empty list', []],
    ['commits without a sha', [{ shortSha: 'abc1234', message: 'm' }, { sha: '', message: 'n' }, { sha: '   ' }]],
  ])('refuses %s at a terminal with exit 2 naming --commit <sha>, asking nothing', async (_label, commits) => {
    const { deps, payloads } = harness(commits as Commit[]);

    const failure = await promptForCommit(deps, SCOPE).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as Error).message).toBe('No commits are available to choose from. Pass --commit <sha> instead.');
    expect(payloads).toEqual([]);
  });

  it('skips a hashless commit but still offers the others', async () => {
    const sha = randomBytes(20).toString('hex');
    const { deps, payloads } = harness([{ message: 'no sha' }, { sha, message: 'ok' }], sha);

    await promptForCommit(deps, SCOPE);

    expect(payloads[0]).toMatchObject({ choices: [{ value: sha }] });
    expect((payloads[0].choices as unknown[]).length).toBe(1);
  });

  it('refuses without a terminal before reading commits or asking', async () => {
    const { deps, scopes, payloads } = harness([{ sha: randomBytes(20).toString('hex') }], 'x', false);

    const failure = await promptForCommit(deps, SCOPE).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe(
      'Choosing a commit needs an interactive terminal. Pass --commit <sha> instead.',
    );
    expect(scopes).toEqual([]);
    expect(payloads).toEqual([]);
  });

  it('propagates a failed commits lookup unchanged and asks nothing', async () => {
    const failure = new LaunchApiError(500, []);
    const { deps, payloads } = harness(failure);

    await expect(promptForCommit(deps, SCOPE)).rejects.toBe(failure);
    expect(payloads).toEqual([]);
  });

  it('treats an empty answer as a cancellation', async () => {
    const { deps } = harness([{ sha: randomBytes(20).toString('hex'), message: 'm' }], undefined);

    await expect(promptForCommit(deps, SCOPE)).rejects.toBeInstanceOf(CancelledError);
  });

  it('falls back to the first seven characters of the sha and to the hash alone when there is no subject', () => {
    const sha = randomBytes(20).toString('hex');

    expect(commitChoice({ sha, message: '' })).toEqual({ name: sha.slice(0, 7), value: sha });
    expect(commitChoice({ sha, shortSha: '  ', message: 'x' })).toEqual({ name: `${sha.slice(0, 7)}  x`, value: sha });
  });

  it.each([
    ['a colour sequence', 'fix \u001b[31mred\u001b[0m', 'abc1234  fix red'],
    ['an OSC title sequence', 'x\u001b]0;pwned\u0007y', 'abc1234  xy'],
    ['a lone carriage return', 'first\rsecond', 'abc1234  first'],
    ['a carriage return and line feed', 'first\r\nsecond', 'abc1234  first'],
    ['a leading carriage return', '\rhidden', 'abc1234'],
    ['a tab and a bell', 'a\tb\u0007c', 'abc1234  a b c'],
  ])('never lets %s in a commit message reach the label', (_label, message, expected) => {
    const sha = randomBytes(20).toString('hex');

    expect(commitChoice({ sha, shortSha: 'abc1234', message })).toEqual({ name: expected, value: sha });
  });

  it('strips control characters from the short hash too and falls back when nothing is left', () => {
    const sha = randomBytes(20).toString('hex');

    expect(commitChoice({ sha, shortSha: 'ab\u001b[31mc12\u001b[0m', message: 'm' }).name).toBe('abc12  m');
    expect(commitChoice({ sha, shortSha: '\u0007', message: '' }).name).toBe(sha.slice(0, 7));
  });
});
