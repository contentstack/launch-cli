import { randomUUID } from 'node:crypto';

import { Parser } from '@oclif/core';
import type { Errors } from '@oclif/core';

import { gluedValue } from '../../../../test/support/glued-value';
import { MissingInputError, UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { LaunchApiError } from '../../../transport/errors';
import { catalog } from '../../../resources';
import { UNSET_INVALID_ARGUMENTS_MESSAGE } from '../../../secrets/secret.rules';
import SecretsUnset from './unset';

interface Harness {
  key?: unknown;
  yes?: unknown;
  isTTY?: boolean;
  outputIsTTY?: boolean;
  confirmed?: boolean;
  removeFails?: Record<string, Error>;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: Record<string, unknown>[] = [];
  const removals: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload as Record<string, unknown>);

      return (harness.confirmed ?? true) as never;
    },
  };
  const command = Object.create(SecretsUnset.prototype) as SecretsUnset;

  Object.assign(command, {
    ux,
    resolved: {
      org: 'org1',
      project: 'proj1',
      env: 'env1',
      yes: 'yes' in harness ? harness.yes : false,
      key: 'key' in harness ? harness.key : ['API_TOKEN'],
    },
    services: {
      ux,
      isTTY: harness.isTTY ?? true,
      outputIsTTY: harness.outputIsTTY ?? false,
      api: {
        secrets: {
          remove: async (params: { key: string }) => {
            removals.push(params);

            if (harness.removeFails?.[params.key]) {
              throw harness.removeFails[params.key];
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, removals };
}

describe('launch:secrets:unset', () => {
  it('U1 with --yes deletes every key in order with the resolved scope, prompts for nothing and prints a line per key', async () => {
    const { command, lines, inquired, removals } = commandUnderTest({ yes: true, key: ['B', 'A'] });

    await command.run();

    expect(inquired).toEqual([]);
    expect(removals).toEqual([
      { org: 'org1', project: 'proj1', environment: 'env1', key: 'B' },
      { org: 'org1', project: 'proj1', environment: 'env1', key: 'A' },
    ]);
    expect(lines).toEqual(['✔ Secret B removed.', '✔ Secret A removed.']);
  });

  it('U2 asks the confirmation on a terminal and deletes when it is accepted', async () => {
    const { command, inquired, removals } = commandUnderTest({ confirmed: true });

    await command.run();

    expect(inquired).toEqual([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to remove the secret API_TOKEN from this environment?',
        default: false,
      },
    ]);
    expect(removals).toHaveLength(1);
  });

  it('U2 says the secrets were not removed, exits 3 and deletes nothing when the user declines', async () => {
    const { command, lines, removals } = commandUnderTest({ confirmed: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(removals).toEqual([]);
    expect(lines).toEqual(['Secrets not removed.']);
  });

  it('colours the not-removed line yellow when stdout is a terminal', async () => {
    const { command, lines } = commandUnderTest({ confirmed: false, outputIsTTY: true });

    await command.run().catch(() => undefined);

    expect(lines).toEqual(['\u001b[33mSecrets not removed.\u001b[39m']);
  });

  it.each([['yes'], [1], ['true'], [undefined], [null]])('does not treat --yes=%p as a yes: only true skips the question', async (yes) => {
    const { command, inquired, removals } = commandUnderTest({ yes, confirmed: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(inquired).toHaveLength(1);
    expect(removals).toEqual([]);
  });

  it('U3 exits 2 naming --yes, asking nothing and deleting nothing, when there is no terminal and no --yes', async () => {
    const { command, inquired, removals } = commandUnderTest({ isTTY: false, yes: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      'Are you sure you want to remove the secret API_TOKEN from this environment? ' +
        'Pass --yes to confirm without an interactive terminal.',
    );
    expect(inquired).toEqual([]);
    expect(removals).toEqual([]);
  });

  it('U4 exits 1 naming the key that stayed, after deleting the rest', async () => {
    const missing = new LaunchApiError(404, [{ message: 'No secret with that key exists in this environment.' }]);
    const { command, lines, removals } = commandUnderTest({ yes: true, key: ['A', 'B'], removeFails: { A: missing } });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { exitCode?: number; message: string };

    expect(error.exitCode).toBe(1);
    expect(error.message).toBe('1 of 2 secrets were not removed: A.');
    expect(removals).toHaveLength(2);
    expect(lines).toEqual(['Secret A was not removed: No secret with that key exists in this environment.', '✔ Secret B removed.']);
  });

  it.each([[undefined], [[]], [['']], [['  ']], [[' ', '']]])('U6 exits 2 naming --key when none was given (%p) and calls nothing', async (key) => {
    const { command, inquired, removals } = commandUnderTest({ key, yes: true });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as MissingInputError;

    expect(error).toBeInstanceOf(MissingInputError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('--key');
    expect(inquired).toEqual([]);
    expect(removals).toEqual([]);
  });

  it('ignores a blank entry next to a real key', async () => {
    const { command, removals } = commandUnderTest({ key: ['', 'API_TOKEN'], yes: true });

    await command.run();

    expect(removals).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', key: 'API_TOKEN' }]);
  });

  it('declares org, project, env, key and yes, and no value flag, positional or short flag', () => {
    expect(SecretsUnset.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      key: {},
      yes: {},
    });
    expect(Object.keys(SecretsUnset.flags).sort()).toEqual(['env', 'key', 'org', 'project', 'yes']);
    expect(Object.values(SecretsUnset.flags).map((flag) => (flag as { char?: string }).char)).not.toContain('v');
    expect(SecretsUnset.args).toEqual({});
    expect(SecretsUnset.strict).toBe(true);
  });

  it('describes --key as a secret key that repeats, and leaves the shared catalog wording alone', () => {
    expect(SecretsUnset.flags.key.description).toBe('Secret key, repeatable');
    expect(SecretsUnset.flags.key.multiple).toBe(true);
    expect(catalog.key.description).toBe('Environment variable key, repeatable');
    expect(SecretsUnset.flags.org).toBe(catalog.org);
  });

  describe('catch', () => {
    function stderrLines(): string[] {
      const written: string[] = [];

      jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });

      return written;
    }

    it.each([
      ['a positional', ['--key', 'K', '--', randomUUID()]],
      ['a --value=', [`--value=${randomUUID()}`]],
      ['a -v attached', [`-v${gluedValue()}`]],
    ])('prints only the generic invalid-arguments line and exits 2 for a real parse error from %s', async (_label, argv) => {
      const token = argv[argv.length - 1].replace(/^(--value=|-v)/, '');
      const raw = (await Parser.parse(argv, { flags: { key: catalog.key, yes: catalog.yes }, strict: true }).catch(
        (error: unknown) => error,
      )) as Error;
      const written = stderrLines();
      const { command } = commandUnderTest({});

      const error = (await (command as unknown as { catch(e: Error): Promise<unknown> })
        .catch(raw)
        .catch((thrown: unknown) => thrown)) as Errors.CLIError;

      expect(error.oclif.exit).toBe(2);
      expect(error.message).toBe(UNSET_INVALID_ARGUMENTS_MESSAGE);
      expect(written).toEqual([`error: ${UNSET_INVALID_ARGUMENTS_MESSAGE}\n`]);
      expect(raw.message).toContain(token);
      expect(written.join('')).not.toContain(token);
    });

    it('reports any other failure by its own message', async () => {
      const written = stderrLines();
      const { command } = commandUnderTest({});

      const error = (await (command as unknown as { catch(e: Error): Promise<unknown> })
        .catch(new UsageError('some usage problem'))
        .catch((thrown: unknown) => thrown)) as Errors.CLIError;

      expect(error.oclif.exit).toBe(2);
      expect(written).toEqual(['error: some usage problem\n']);
    });
  });
});
