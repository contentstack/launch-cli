import { randomUUID } from 'node:crypto';

import { LaunchCommand } from '../../../core/launch-command';
import type { UxLike } from '../../../core/prompt';
import { GENERIC_ARGUMENTS_MESSAGE } from '../../../secrets/secrets.redact';
import { SECRETS_ERROR_MESSAGES, SECRETS_FORBIDDEN_MESSAGE } from '../../../secrets/secrets.errors';
import { LaunchApiError } from '../../../transport/errors';
import SecretsUnset from './unset';

interface Harness {
  key?: string[];
  yes?: boolean;
  isTTY?: boolean;
  answer?: unknown;
  failure?: Error;
}

function commandUnderTest(harness: Harness = {}) {
  const lines: string[] = [];
  const inquired: Record<string, unknown>[] = [];
  const deleted: unknown[][] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload as Record<string, unknown>);
      return (harness.answer ?? true) as never;
    },
  };
  const command = Object.create(SecretsUnset.prototype) as SecretsUnset;

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
          delete: async (...args: unknown[]) => {
            deleted.push(args);

            if (harness.failure) {
              throw harness.failure;
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, deleted };
}

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

describe('launch:secrets:unset', () => {
  it('deletes every key in order without asking when --yes was passed, with one success line per key', async () => {
    const { command, inquired, deleted, lines } = commandUnderTest({ yes: true, key: ['API_TOKEN', 'DB_URL'] });

    await command.run();

    expect(inquired).toEqual([]);
    expect(deleted).toEqual([
      [SCOPE, 'API_TOKEN'],
      [SCOPE, 'DB_URL'],
    ]);
    expect(lines).toEqual(['✔ Secret API_TOKEN removed.', '✔ Secret DB_URL removed.']);
  });

  it('asks on a terminal and deletes when the answer is yes', async () => {
    const { command, inquired, deleted } = commandUnderTest({ answer: true });

    await command.run();

    expect(inquired.map((payload) => payload.type)).toEqual(['confirm']);
    expect(inquired[0].message).toBe('Remove the secret API_TOKEN from this environment? This cannot be undone.');
    expect(deleted).toEqual([[SCOPE, 'API_TOKEN']]);
  });

  it('says the secrets were not removed and exits 3 without sending when the user declines', async () => {
    const { command, lines, deleted } = commandUnderTest({ answer: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(deleted).toEqual([]);
    expect(lines).toEqual(['Secrets not removed.']);
  });

  it('lets an API failure propagate with its own message and the exit code it carries', async () => {
    const failure = new LaunchApiError(
      403,
      [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.FORBIDDEN' }],
      SECRETS_ERROR_MESSAGES,
    );
    const { command, lines } = commandUnderTest({ yes: true, failure });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as LaunchApiError;

    expect(error).toBe(failure);
    expect(error.message).toBe(SECRETS_FORBIDDEN_MESSAGE);
    expect(error.exitCode).toBe(1);
    expect(lines).toEqual([]);
  });

  it('hands every failure on with a --flag=value pair and an unexpected argument scrubbed of the value', async () => {
    const handed: Error[] = [];
    jest
      .spyOn(LaunchCommand.prototype as unknown as { catch: (err: Error) => Promise<unknown> }, 'catch')
      .mockImplementation(async (err) => {
        handed.push(err);
        return 'handled';
      });
    const { command } = commandUnderTest();
    const value = randomUUID();
    const flagged = new Error(`Nonexistent flag: --value=${value}`);
    const positional = new Error(`Unexpected argument: ${value}`);
    const call = (err: Error) => (command as unknown as { catch: (err: Error) => Promise<unknown> }).catch(err);

    const results = [await call(flagged), await call(positional)];

    expect(results).toEqual(['handled', 'handled']);
    expect(handed.map((error) => error.message)).toEqual(['Nonexistent flag: --value', GENERIC_ARGUMENTS_MESSAGE]);
  });

  it('declares org, project, env, a required key and yes, and has no value flag', () => {
    expect(SecretsUnset.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      key: { required: true },
      yes: {},
    });
    expect(Object.keys(SecretsUnset.flags).sort()).toEqual(['env', 'key', 'org', 'project', 'yes']);
  });
});
