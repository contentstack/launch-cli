import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import EnvironmentsDelete from './delete';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

interface Harness {
  answer?: boolean;
  isTTY?: boolean;
  yes?: boolean;
  getFails?: Error;
  deleteFails?: Error;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: unknown[] = [];
  const calls: string[] = [];
  const got: unknown[] = [];
  const deleted: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload);
      return harness.answer as never;
    },
  };
  const command = Object.create(EnvironmentsDelete.prototype) as EnvironmentsDelete;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1', yes: harness.yes ?? false },
    services: {
      ux,
      isTTY: harness.isTTY ?? true,
      api: {
        environments: {
          get: async (params: unknown) => {
            calls.push('get');
            got.push(params);

            if (harness.getFails) {
              throw harness.getFails;
            }

            return { uid: 'env1', name: 'production' };
          },
          delete: async (params: unknown) => {
            calls.push('delete');
            deleted.push(params);

            if (harness.deleteFails) {
              throw harness.deleteFails;
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, calls, got, deleted };
}

describe('launch:env:delete', () => {
  it('fetches the environment, confirms, deletes it and says so', async () => {
    const { command, lines, inquired, calls, got, deleted } = commandUnderTest({ answer: true });

    await command.run();

    expect(inquired).toEqual([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to delete this environment?',
        default: false,
      },
    ]);
    expect(calls).toEqual(['get', 'delete']);
    expect(got).toEqual([SCOPE]);
    expect(deleted).toEqual([SCOPE]);
    expect(lines).toEqual(['✔ Environment deleted successfully.']);
  });

  it('skips the question entirely when --yes was passed', async () => {
    const { command, lines, inquired, calls } = commandUnderTest({ yes: true });

    await command.run();

    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get', 'delete']);
    expect(lines).toEqual(['✔ Environment deleted successfully.']);
  });

  it('says the environment was not deleted and exits 3 without sending the delete when the user declines', async () => {
    const { command, lines, calls, deleted } = commandUnderTest({ answer: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(calls).toEqual(['get']);
    expect(deleted).toEqual([]);
    expect(lines).toEqual(['Environment not deleted.']);
  });

  it('exits 2 naming --yes without asking or sending the delete when there is no terminal', async () => {
    const { command, lines, inquired, calls, deleted } = commandUnderTest({ isTTY: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      'Are you sure you want to delete this environment? Pass --yes to confirm without an interactive terminal.',
    );
    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get']);
    expect(deleted).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('propagates a failed lookup without asking or deleting anything', async () => {
    const failure = new Error('lookup exploded');
    const { command, lines, calls, inquired } = commandUnderTest({ answer: true, getFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(calls).toEqual(['get']);
    expect(inquired).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('propagates a failed delete rather than reporting a success', async () => {
    const failure = new Error('delete exploded');
    const { command, lines, calls } = commandUnderTest({ yes: true, deleteFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(calls).toEqual(['get', 'delete']);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required and opts into the confirm gate', () => {
    expect(EnvironmentsDelete.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      yes: {},
    });
    expect(Object.keys(EnvironmentsDelete.flags).sort()).toEqual(['env', 'org', 'project', 'yes']);
  });
});
