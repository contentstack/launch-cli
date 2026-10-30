import { randomUUID } from 'node:crypto';

import { Parser } from '@oclif/core';
import type { Errors } from '@oclif/core';

import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { catalog } from '../../../resources';
import { INVALID_ARGUMENTS_MESSAGE } from '../../../secrets/secret.rules';
import SecretsSet from './set';

interface Harness {
  key?: unknown;
  yes?: unknown;
  isTTY?: boolean;
  outputIsTTY?: boolean;
  typed?: string;
  piped?: string;
  confirmed?: boolean;
  held?: { key: string }[];
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: Record<string, unknown>[] = [];
  const writes: { method: string; params: unknown }[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload as Record<string, unknown>);
      const { type } = payload as { type: string };

      return (type === 'confirm' ? (harness.confirmed ?? true) : harness.typed) as never;
    },
  };
  const command = Object.create(SecretsSet.prototype) as SecretsSet;

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
          list: async () => harness.held ?? [],
          add: async (params: unknown) => {
            writes.push({ method: 'add', params });
          },
          refresh: async (params: unknown) => {
            writes.push({ method: 'refresh', params });
          },
        },
      },
    },
  });

  return { command, lines, inquired, writes };
}

describe('launch:secrets:set', () => {
  it('asks for the value at a masked prompt, confirms, adds the secret and says so without the value', async () => {
    const value = randomUUID();
    const { command, lines, inquired, writes } = commandUnderTest({ typed: value });

    await command.run();

    expect(inquired.map((payload) => payload.type)).toEqual(['password', 'confirm']);
    expect(inquired[1]).toEqual({
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to add the secret API_TOKEN?',
      default: false,
    });
    expect(writes).toEqual([
      { method: 'add', params: { org: 'org1', project: 'proj1', environment: 'env1', key: 'API_TOKEN', value } },
    ]);
    expect(lines).toEqual(['✔ Secret API_TOKEN added.']);
    expect(JSON.stringify(inquired[1])).not.toContain(value);
  });

  it('refreshes a held key', async () => {
    const value = randomUUID();
    const { command, writes, lines } = commandUnderTest({ typed: value, held: [{ key: 'API_TOKEN' }] });

    await command.run();

    expect(writes.map((write) => write.method)).toEqual(['refresh']);
    expect(lines).toEqual(['✔ Secret API_TOKEN updated.']);
  });

  it('skips the question when --yes was passed on a terminal', async () => {
    const { command, inquired, writes } = commandUnderTest({ typed: randomUUID(), yes: true });

    await command.run();

    expect(inquired.map((payload) => payload.type)).toEqual(['password']);
    expect(writes).toHaveLength(1);
  });

  it.each([['yes'], [1], ['true'], [undefined]])('does not treat --yes=%p as a yes: only true skips the question', async (yes) => {
    const { command, inquired } = commandUnderTest({ typed: randomUUID(), yes, confirmed: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(inquired.map((payload) => payload.type)).toEqual(['password', 'confirm']);
  });

  it('S4 says the secret was not saved and exits 3 without writing when the user declines', async () => {
    const { command, lines, writes } = commandUnderTest({ typed: randomUUID(), confirmed: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(writes).toEqual([]);
    expect(lines).toEqual(['Secret not saved.']);
  });

  it('colours the not-saved line yellow when stdout is a terminal', async () => {
    const { command, lines } = commandUnderTest({ typed: randomUUID(), confirmed: false, outputIsTTY: true });

    await command.run().catch(() => undefined);

    expect(lines).toEqual(['\u001b[33mSecret not saved.\u001b[39m']);
  });

  it('S6 exits 2 naming --yes, reading and prompting for nothing, when stdin is piped without --yes', async () => {
    const { command, inquired, writes } = commandUnderTest({ isTTY: false, yes: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('Pass --yes when piping the value');
    expect(inquired).toEqual([]);
    expect(writes).toEqual([]);
  });

  it.each([[undefined], [[]], [['']], [['  ']], [[' ', '']]])('exits 2 naming --key when none was given (%p)', async (key) => {
    const { command, writes, inquired } = commandUnderTest({ key });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('Missing required value for --key. Pass --key.');
    expect(inquired).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('exits 2 without echoing the extra token when more than one key is given, as `--key K <value>` parses', async () => {
    const value = randomUUID();
    const { command, writes, inquired } = commandUnderTest({ key: ['API_TOKEN', value] });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('launch:secrets:set sets one secret at a time. Pass --key once.');
    expect(error.message).not.toContain(value);
    expect(inquired).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('ignores a blank entry next to one real key', async () => {
    const { command, writes } = commandUnderTest({ key: ['', 'API_TOKEN'], typed: randomUUID(), yes: true });

    await command.run();

    expect(writes).toHaveLength(1);
    expect((writes[0].params as { key: string }).key).toBe('API_TOKEN');
  });

  it('declares org, project, env, key and yes, and no value flag, positional or short flag', () => {
    expect(SecretsSet.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      key: {},
      yes: {},
    });
    expect(Object.keys(SecretsSet.flags).sort()).toEqual(['env', 'key', 'org', 'project', 'yes']);
    expect(Object.keys(SecretsSet.flags)).not.toContain('value');
    expect(Object.values(SecretsSet.flags).map((flag) => (flag as { char?: string }).char)).not.toContain('v');
    expect(SecretsSet.args).toEqual({});
    expect(SecretsSet.strict).toBe(true);
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
      ['a -v attached', [`-v${randomUUID()}`]],
    ])('S8 prints only the generic invalid-arguments line and exits 2 for a real parse error from %s', async (_label, argv) => {
      const raw = (await Parser.parse(argv, { flags: { key: catalog.key, yes: catalog.yes }, strict: true }).catch(
        (error: unknown) => error,
      )) as Error;
      const written = stderrLines();
      const { command } = commandUnderTest({});

      const error = (await (command as unknown as { catch(e: Error): Promise<unknown> })
        .catch(raw)
        .catch((thrown: unknown) => thrown)) as Errors.CLIError;

      expect(error.oclif.exit).toBe(2);
      expect(error.message).toBe(INVALID_ARGUMENTS_MESSAGE);
      expect(written).toEqual([`error: ${INVALID_ARGUMENTS_MESSAGE}\n`]);
      expect(raw.message).toContain(argv[argv.length - 1].replace(/^(--value=|-v)/, ''));
      expect(written.join('')).not.toContain(argv[argv.length - 1].replace(/^(--value=|-v)/, ''));
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
