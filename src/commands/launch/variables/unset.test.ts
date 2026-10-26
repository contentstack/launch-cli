import { MissingInputError, UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import VariablesUnset from './unset';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

interface Harness {
  answer?: boolean;
  isTTY?: boolean;
  yes?: boolean;
  key?: string[];
  updateFails?: Error;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: unknown[] = [];
  const calls: string[] = [];
  const updates: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload);
      return harness.answer as never;
    },
  };
  const command = Object.create(VariablesUnset.prototype) as VariablesUnset;

  Object.assign(command, {
    ux,
    resolved: {
      org: 'org1',
      project: 'proj1',
      env: 'env1',
      yes: harness.yes ?? false,
      key: 'key' in harness ? harness.key : ['API_KEY'],
    },
    services: {
      ux,
      isTTY: harness.isTTY ?? true,
      outputIsTTY: false,
      api: {
        environments: {
          get: async () => {
            calls.push('get');
            return { name: 'staging', environmentVariables: [{ key: 'API_KEY', value: 'never-printed-value' }, { key: 'DEBUG', value: 'x' }] };
          },
        },
        variables: {
          patch: async (params: unknown) => {
            calls.push('patch');
            updates.push(params);

            if (harness.updateFails) {
              throw harness.updateFails;
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, calls, updates };
}

describe('launch:variables:unset', () => {
  it('confirms, removes only the named key and says so', async () => {
    const { command, lines, inquired, calls, updates } = commandUnderTest({ answer: true });

    await command.run();

    expect(inquired).toEqual([
      { type: 'confirm', name: 'confirm', message: 'Are you sure you want to remove the variable API_KEY from the "staging" environment?', default: false },
    ]);
    expect(calls).toEqual(['get', 'patch']);
    expect(updates).toEqual([{ ...SCOPE, unset: ['API_KEY'] }]);
    expect(lines).toEqual(['✔ Variable API_KEY removed from the "staging" environment.']);
    expect(lines.join('')).not.toContain('never-printed-value');
  });

  it('skips the question when --yes was passed', async () => {
    const { command, inquired, calls, lines } = commandUnderTest({ yes: true });

    await command.run();

    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get', 'patch']);
    expect(lines).toEqual(['✔ Variable API_KEY removed from the "staging" environment.']);
  });

  it('says the variables were not removed and exits 3 without writing when the user declines', async () => {
    const { command, lines, updates } = commandUnderTest({ answer: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(updates).toEqual([]);
    expect(lines).toEqual(['Variables not removed.']);
  });

  it('exits 2 naming --yes without asking or writing when there is no terminal', async () => {
    const { command, inquired, updates, lines } = commandUnderTest({ isTTY: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      'Are you sure you want to remove the variable API_KEY from the "staging" environment? Pass --yes to confirm without an interactive terminal.',
    );
    expect(inquired).toEqual([]);
    expect(updates).toEqual([]);
    expect(lines).toEqual([]);
  });

  it.each([[undefined], [[]]])('exits 2 naming --key when none was given (%p)', async (key) => {
    const { command, calls } = commandUnderTest({ key: key as string[] | undefined });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as MissingInputError;

    expect(error).toBeInstanceOf(MissingInputError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('--key');
    expect(calls).toEqual([]);
  });

  it('refuses a key that is not set without asking or writing', async () => {
    const { command, inquired, updates } = commandUnderTest({ key: ['NOPE'] });

    await expect(command.run()).rejects.toThrow('NOPE is not set in this environment.');
    expect(inquired).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('propagates a failed write rather than reporting a success', async () => {
    const failure = new Error('update exploded');
    const { command, lines } = commandUnderTest({ yes: true, updateFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('declares org, project, env and key and opts into the confirm gate', () => {
    expect(VariablesUnset.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      key: {},
      yes: {},
    });
    expect(Object.keys(VariablesUnset.flags).sort()).toEqual(['env', 'key', 'org', 'project', 'yes']);
  });
});
