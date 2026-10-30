import { randomUUID } from 'node:crypto';

import { UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { LaunchApiError, LaunchNetworkError } from '../transport/errors';
import { SecretRemover } from './secret.unset';
import { SecretsNotRemovedError } from './secrets.errors';
import type { SecretKeyParams } from './types';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

interface Harness {
  outputIsTTY?: boolean;
  confirmed?: boolean;
  failures?: Record<string, unknown>;
  keys?: string[];
}

function harnessed(harness: Harness) {
  const events: string[] = [];
  const lines: string[] = [];
  const questions: string[] = [];
  const removals: SecretKeyParams[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      events.push('print');
      lines.push(message);
    },
    inquire: async () => {
      events.push('prompt');
      return true as never;
    },
  };
  const services = {
    ux,
    isTTY: false,
    outputIsTTY: harness.outputIsTTY ?? false,
    api: {
      secrets: {
        remove: async (params: SecretKeyParams) => {
          events.push(`remove ${params.key}`);
          removals.push(params);

          if (harness.failures && params.key in harness.failures) {
            throw harness.failures[params.key];
          }
        },
      },
    },
  } as unknown as ServiceContext;
  const confirm = async (question: string) => {
    events.push('confirm');
    questions.push(question);
    return harness.confirmed ?? true;
  };
  const remover = new SecretRemover(services, confirm);
  const run = () => remover.remove({ ...SCOPE, keys: harness.keys ?? ['A', 'B'] });

  return { run, events, lines, questions, removals };
}

describe('SecretRemover.remove', () => {
  it('U1 confirms once, then deletes each key in the order given and prints one success line per key', async () => {
    const { run, events, lines, questions, removals } = harnessed({ keys: ['B', 'A'] });

    await expect(run()).resolves.toBe(true);

    expect(events).toEqual(['confirm', 'remove B', 'print', 'remove A', 'print']);
    expect(removals).toEqual([
      { ...SCOPE, key: 'B' },
      { ...SCOPE, key: 'A' },
    ]);
    expect(questions).toEqual(['Are you sure you want to remove the secrets B, A from this environment?']);
    expect(lines).toEqual(['✔ Secret B removed.', '✔ Secret A removed.']);
  });

  it('asks the singular question for one key', async () => {
    const { run, questions, lines } = harnessed({ keys: ['API_TOKEN'] });

    await run();

    expect(questions).toEqual(['Are you sure you want to remove the secret API_TOKEN from this environment?']);
    expect(lines).toEqual(['✔ Secret API_TOKEN removed.']);
  });

  it('deletes a repeated key once and asks about it once', async () => {
    const { run, removals, questions } = harnessed({ keys: ['A', 'B', 'A'] });

    await run();

    expect(removals.map((removal) => removal.key)).toEqual(['A', 'B']);
    expect(questions[0]).toContain('secrets A, B from');
  });

  it('U2 returns false and deletes nothing when the confirmation is declined', async () => {
    const { run, events, lines, removals } = harnessed({ confirmed: false });

    await expect(run()).resolves.toBe(false);

    expect(events).toEqual(['confirm']);
    expect(removals).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('colours the success line green when stdout is a terminal and leaves it plain otherwise', async () => {
    const tty = harnessed({ outputIsTTY: true, keys: ['A'] });
    const plain = harnessed({ outputIsTTY: false, keys: ['A'] });

    await tty.run();
    await plain.run();

    expect(tty.lines).toEqual(['\u001b[32m✔ Secret A removed.\u001b[39m']);
    expect(plain.lines).toEqual(['✔ Secret A removed.']);
  });

  it('U4 reports the key that failed, still deletes the others in order, then fails naming the key that stayed', async () => {
    const missing = new LaunchApiError(404, [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND' }], {
      'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND': 'No secret with that key exists in this environment.',
    });
    const { run, events, lines, removals } = harnessed({ keys: ['A', 'B', 'C'], failures: { B: missing } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsNotRemovedError;

    expect(error).toBeInstanceOf(SecretsNotRemovedError);
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe('1 of 3 secrets were not removed: B.');
    expect(removals.map((removal) => removal.key)).toEqual(['A', 'B', 'C']);
    expect(events).toEqual(['confirm', 'remove A', 'print', 'remove B', 'print', 'remove C', 'print']);
    expect(lines).toEqual([
      '✔ Secret A removed.',
      'Secret B was not removed: No secret with that key exists in this environment.',
      '✔ Secret C removed.',
    ]);
  });

  it('U5 reports a 403 for every key, deletes each, and fails naming all of them', async () => {
    const forbidden = new LaunchApiError(403, [{ message: 'You do not have permission to change the secrets of this environment.' }]);
    const { run, lines, removals } = harnessed({ keys: ['A', 'B'], failures: { A: forbidden, B: forbidden } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsNotRemovedError;

    expect(error.message).toBe('2 of 2 secrets were not removed: A, B.');
    expect(removals).toHaveLength(2);
    expect(lines).toEqual([
      'Secret A was not removed: You do not have permission to change the secrets of this environment.',
      'Secret B was not removed: You do not have permission to change the secrets of this environment.',
    ]);
  });

  it('colours a failure line red when stdout is a terminal', async () => {
    const { run, lines } = harnessed({
      outputIsTTY: true,
      keys: ['A'],
      failures: { A: new LaunchApiError(403, [{ message: 'no' }]) },
    });

    await run().catch(() => undefined);

    expect(lines).toEqual(['\u001b[31mSecret A was not removed: no\u001b[39m']);
  });

  it('stops at an error that is not an API answer, since the remaining keys would fail the same way', async () => {
    const network = new LaunchNetworkError(`cannot reach ${randomUUID()}`, undefined);
    const { run, removals, lines } = harnessed({ keys: ['A', 'B', 'C'], failures: { B: network } });

    const error = await run().catch((thrown: unknown) => thrown);

    expect(error).toBe(network);
    expect(removals.map((removal) => removal.key)).toEqual(['A', 'B']);
    expect(lines).toEqual(['✔ Secret A removed.']);
  });

  it('lets a usage error propagate as it is', async () => {
    const usage = new UsageError('bad');
    const { run } = harnessed({ keys: ['A'], failures: { A: usage } });

    await expect(run()).rejects.toBe(usage);
  });

  it('lets a failure of the confirmation propagate before any request', async () => {
    const { removals } = harnessed({});
    const refusal = new UsageError('Pass --yes to confirm without an interactive terminal.');
    const services = { ux: { print: () => undefined }, api: { secrets: { remove: async () => undefined } } } as unknown as ServiceContext;
    const remover = new SecretRemover(services, async () => {
      throw refusal;
    });

    await expect(remover.remove({ ...SCOPE, keys: ['A'] })).rejects.toBe(refusal);
    expect(removals).toEqual([]);
  });
});
