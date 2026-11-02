import { randomUUID } from 'node:crypto';

import { UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { LaunchApiError, LaunchNetworkError } from '../transport/errors';
import { SecretRemover } from './secret.unset';
import { SecretsNotRemovedError, SecretsRemovalStoppedError } from './secrets.errors';
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

  it('stops at a network failure on the middle key and names what was removed, what failed and what was not attempted', async () => {
    const network = new LaunchNetworkError(`cannot reach ${randomUUID()}`, undefined);
    const { run, removals, lines, events } = harnessed({ keys: ['A', 'B', 'C', 'D', 'E'], failures: { C: network } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsRemovalStoppedError;

    expect(error).toBeInstanceOf(SecretsRemovalStoppedError);
    expect(error.exitCode).toBe(1);
    expect(error.cause).toBe(network);
    expect(error.message).toBe(
      `Stopped at secret C: ${network.message}\nRemoved: A, B.\nFailed: C.\nNot attempted: D, E.`,
    );
    expect(removals.map((removal) => removal.key)).toEqual(['A', 'B', 'C']);
    expect(events).toEqual(['confirm', 'remove A', 'print', 'remove B', 'print', 'remove C']);
    expect(lines).toEqual(['✔ Secret A removed.', '✔ Secret B removed.']);
  });

  it('counts an earlier API failure as failed and never lists the stopping key as removed', async () => {
    const missing = new LaunchApiError(404, [{ message: 'gone' }]);
    const network = new LaunchNetworkError('down', undefined);
    const { run, removals } = harnessed({ keys: ['A', 'B', 'C', 'D'], failures: { A: missing, C: network } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsRemovalStoppedError;

    expect(error.message).toBe('Stopped at secret C: down\nRemoved: B.\nFailed: A, C.\nNot attempted: D.');
    expect(removals.map((removal) => removal.key)).toEqual(['A', 'B', 'C']);
  });

  it('reports a network failure on the last key with nothing left unattempted', async () => {
    const { run } = harnessed({ keys: ['A', 'B'], failures: { B: new LaunchNetworkError('down', undefined) } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsRemovalStoppedError;

    expect(error.message).toBe('Stopped at secret B: down\nRemoved: A.\nFailed: B.\nNot attempted: none.');
  });

  it('stops the same way for any other error, keeping it as the cause', async () => {
    const usage = new UsageError('bad');
    const { run, removals } = harnessed({ keys: ['A', 'B'], failures: { A: usage } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsRemovalStoppedError;

    expect(error).toBeInstanceOf(SecretsRemovalStoppedError);
    expect(error.cause).toBe(usage);
    expect(error.message).toBe('Stopped at secret A: bad\nRemoved: none.\nFailed: A.\nNot attempted: B.');
    expect(removals.map((removal) => removal.key)).toEqual(['A']);
  });

  it('words a thrown value that is not an Error by its string form', async () => {
    const { run } = harnessed({ keys: ['A'], failures: { A: 'plain text' } });

    const error = (await run().catch((thrown: unknown) => thrown)) as SecretsRemovalStoppedError;

    expect(error.message).toBe('Stopped at secret A: plain text\nRemoved: none.\nFailed: A.\nNot attempted: none.');
  });

  it.each([['.'], ['..']])('refuses the key %j, with the other keys, before confirming or deleting anything', async (key) => {
    const { run, events, removals } = harnessed({ keys: ['A', key, 'B'] });

    const error = await run().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain(`"${key}"`);
    expect(events).toEqual([]);
    expect(removals).toEqual([]);
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
