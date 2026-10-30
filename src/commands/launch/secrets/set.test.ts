import { randomUUID } from 'node:crypto';

import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { LaunchCommand } from '../../../core/launch-command';
import { GENERIC_ARGUMENTS_MESSAGE } from '../../../secrets/secrets.redact';
import SecretsSet from './set';

interface Harness {
  key?: string[];
  yes?: boolean;
  isTTY?: boolean;
  answer?: unknown;
  existing?: unknown[];
}

function commandUnderTest(harness: Harness = {}) {
  const lines: string[] = [];
  const inquired: Record<string, unknown>[] = [];
  const mutations: string[] = [];
  const sent: unknown[][] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload as Record<string, unknown>);
      return harness.answer as never;
    },
  };
  const command = Object.create(SecretsSet.prototype) as SecretsSet;

  Object.assign(command, {
    ux,
    resolved: {
      org: 'org1',
      project: 'proj1',
      env: 'env1',
      yes: harness.yes ?? false,
      key: harness.key ?? ['API_TOKEN'],
    },
    services: {
      ux,
      isTTY: harness.isTTY ?? true,
      outputIsTTY: false,
      api: {
        secrets: {
          list: async () => harness.existing ?? [],
          add: async (...args: unknown[]) => {
            mutations.push('add');
            sent.push(args);
            return {};
          },
          refresh: async (...args: unknown[]) => {
            mutations.push('refresh');
            sent.push(args);
            return {};
          },
        },
      },
    },
  });

  return { command, lines, inquired, mutations, sent };
}

describe('launch:secrets:set', () => {
  it('asks for a masked value then a confirmation on a terminal and adds the secret', async () => {
    const value = randomUUID();
    const answers = [value, true];
    const { command, inquired, mutations, sent, lines } = commandUnderTest();
    const original = command['ux'].inquire;
    command['ux'].inquire = async (payload: unknown) => {
      await original(payload);
      return answers.shift() as never;
    };

    await command.run();

    expect(inquired.map((payload) => payload.type)).toEqual(['password', 'confirm']);
    expect(inquired[1].message).toBe('Add the secret API_TOKEN to this environment?');
    expect(mutations).toEqual(['add']);
    expect(sent).toEqual([[{ org: 'org1', project: 'proj1', environment: 'env1' }, 'API_TOKEN', value]]);
    expect(lines).toEqual(['✔ Secret API_TOKEN added.']);
    expect(JSON.stringify(inquired[1])).not.toContain(value);
  });

  it('skips the confirmation with --yes and refreshes an existing key', async () => {
    const value = randomUUID();
    const { command, inquired, mutations } = commandUnderTest({
      yes: true,
      answer: value,
      existing: [{ key: 'API_TOKEN' }],
    });

    await command.run();

    expect(inquired.map((payload) => payload.type)).toEqual(['password']);
    expect(mutations).toEqual(['refresh']);
  });

  it('says the secret was not changed and exits 3 without sending when the user declines', async () => {
    const answers = [randomUUID(), false];
    const { command, lines, mutations } = commandUnderTest();
    command['ux'].inquire = async () => answers.shift() as never;

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(mutations).toEqual([]);
    expect(lines).toEqual(['Secret not changed.']);
  });

  it('reads the value from stdin and exits 2 naming --yes without a terminal, sending nothing', async () => {
    const value = randomUUID();
    const reads: number[] = [];
    const { command, mutations, inquired } = commandUnderTest({ isTTY: false });
    Object.assign(command, {
      readStdin: async () => {
        reads.push(1);
        return value;
      },
    });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      'Add the secret API_TOKEN to this environment? Pass --yes to confirm without an interactive terminal.',
    );
    expect(error.message).not.toContain(value);
    expect(reads).toEqual([1]);
    expect(inquired).toEqual([]);
    expect(mutations).toEqual([]);
  });

  it('adds a piped value without asking anything when --yes was passed', async () => {
    const value = randomUUID();
    const { command, inquired, sent } = commandUnderTest({ isTTY: false, yes: true });
    Object.assign(command, { readStdin: async () => value });

    await command.run();

    expect(inquired).toEqual([]);
    expect(sent).toEqual([[{ org: 'org1', project: 'proj1', environment: 'env1' }, 'API_TOKEN', value]]);
  });

  it.each([[[]], [['A', 'B']]])('exits 2 asking for exactly one --key when given %p', async (key) => {
    const { command, mutations, inquired } = commandUnderTest({ key });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('Pass exactly one --key.');
    expect(mutations).toEqual([]);
    expect(inquired).toEqual([]);
  });

  it('hands every failure on with a --flag=value pair and an unexpected argument scrubbed of the value', async () => {
    const value = randomUUID();
    const handed: Error[] = [];
    jest
      .spyOn(LaunchCommand.prototype as unknown as { catch: (err: Error) => Promise<unknown> }, 'catch')
      .mockImplementation(async (err) => {
        handed.push(err);
        return 'handled';
      });
    const { command } = commandUnderTest();
    const flagged = new Error(`Nonexistent flag: --value=${value}`);
    const positional = new Error(`Unexpected argument: ${value}`);

    const results = [
      await (command as unknown as { catch: (err: Error) => Promise<unknown> }).catch(flagged),
      await (command as unknown as { catch: (err: Error) => Promise<unknown> }).catch(positional),
    ];

    expect(results).toEqual(['handled', 'handled']);
    expect(handed).toEqual([flagged, positional]);
    expect(handed.map((error) => error.message)).toEqual(['Nonexistent flag: --value', GENERIC_ARGUMENTS_MESSAGE]);
  });

  it('declares org, project, env, key and yes, and has no value flag', () => {
    expect(SecretsSet.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      key: { required: true },
      yes: {},
    });
    expect(Object.keys(SecretsSet.flags).sort()).toEqual(['env', 'key', 'org', 'project', 'yes']);
  });
});
