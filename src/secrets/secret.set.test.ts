import { randomUUID } from 'node:crypto';

import { UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { LaunchApiError } from '../transport/errors';
import { clientExposedWarning } from './secret.rules';
import { SecretSetter } from './secret.set';
import type { SecretValueIo } from './secret.value';
import type { SecretSummary, SecretWriteParams } from './types';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

interface Harness {
  isTTY?: boolean;
  outputIsTTY?: boolean;
  held?: SecretSummary[];
  piped?: string;
  typed?: string;
  confirmed?: boolean;
  yes?: boolean;
  key?: string;
  listFails?: Error;
  writeFails?: Error;
  pipeFails?: Error;
}

function harnessed(harness: Harness) {
  const events: string[] = [];
  const lines: string[] = [];
  const questions: string[] = [];
  const prompts: Record<string, unknown>[] = [];
  const lists: unknown[] = [];
  const adds: SecretWriteParams[] = [];
  const refreshes: SecretWriteParams[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      events.push('print');
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      events.push('prompt');
      prompts.push(payload as Record<string, unknown>);
      return harness.typed as never;
    },
  };
  const services = {
    ux,
    isTTY: harness.isTTY ?? false,
    outputIsTTY: harness.outputIsTTY ?? false,
    api: {
      secrets: {
        list: async (params: unknown) => {
          events.push('list');
          lists.push(params);

          if (harness.listFails) {
            throw harness.listFails;
          }

          return harness.held ?? [];
        },
        add: async (params: SecretWriteParams) => {
          events.push('add');
          adds.push(params);

          if (harness.writeFails) {
            throw harness.writeFails;
          }

          return { key: params.key, updatedAt: 'now' };
        },
        refresh: async (params: SecretWriteParams) => {
          events.push('refresh');
          refreshes.push(params);

          if (harness.writeFails) {
            throw harness.writeFails;
          }

          return { key: params.key, updatedAt: 'now' };
        },
      },
    },
  } as unknown as ServiceContext;
  const io: SecretValueIo = {
    readStdin: async () => {
      events.push('stdin');

      if (harness.pipeFails) {
        throw harness.pipeFails;
      }

      return harness.piped ?? '';
    },
    closeStdin: () => undefined,
    stdinTimeoutMs: 1000,
  };
  const confirm = async (question: string) => {
    events.push('confirm');
    questions.push(question);
    return harness.confirmed ?? true;
  };
  const setter = new SecretSetter(services, confirm, io);
  const run = () => setter.set({ ...SCOPE, key: harness.key ?? 'API_TOKEN', yes: harness.yes ?? false });

  return { run, events, lines, questions, prompts, lists, adds, refreshes };
}

describe('SecretSetter.set', () => {
  it.each([['.'], ['..']])('refuses the key %j before it reads stdin or sends anything', async (key) => {
    const { run, events, prompts, lists, adds, refreshes } = harnessed({ key, yes: true, piped: randomUUID() });

    const error = await run().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(2);
    expect((error as UsageError).message).toContain(`"${key}"`);
    expect(events).toEqual([]);
    expect([prompts, lists, adds, refreshes]).toEqual([[], [], [], []]);
  });

  it('S1 adds a key that is absent from piped input with --yes: reads stdin, lists, confirms, POSTs and prompts for nothing', async () => {
    const value = randomUUID();
    const { run, events, prompts, lists, adds, refreshes, lines, questions } = harnessed({
      piped: `${value}\n`,
      yes: true,
      held: [{ key: 'OTHER', updatedAt: 'x' }],
    });

    await expect(run()).resolves.toBe(true);

    expect(events).toEqual(['stdin', 'list', 'confirm', 'add', 'print']);
    expect(prompts).toEqual([]);
    expect(lists).toEqual([SCOPE]);
    expect(adds).toEqual([{ ...SCOPE, key: 'API_TOKEN', value }]);
    expect(refreshes).toEqual([]);
    expect(questions).toEqual(['Are you sure you want to add the secret API_TOKEN?']);
    expect(lines).toEqual(['✔ Secret API_TOKEN added.']);
    expect(lines.join('\n')).not.toContain(value);
    expect(questions.join('\n')).not.toContain(value);
  });

  it('S2 asks a masked prompt for the value on a terminal, then the confirmation, then writes', async () => {
    const value = randomUUID();
    const { run, events, prompts, adds } = harnessed({ isTTY: true, typed: value, confirmed: true });

    await expect(run()).resolves.toBe(true);

    expect(events).toEqual(['prompt', 'list', 'confirm', 'add', 'print']);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ type: 'password', message: 'Value for API_TOKEN' });
    expect(adds).toEqual([{ ...SCOPE, key: 'API_TOKEN', value }]);
  });

  it('S3 refreshes a key that is already a secret with a PUT and never POSTs', async () => {
    const value = randomUUID();
    const { run, events, adds, refreshes, lines, questions } = harnessed({
      piped: value,
      yes: true,
      held: [{ key: 'OTHER', updatedAt: 'x' }, { key: 'API_TOKEN', updatedAt: 'y' }],
    });

    await expect(run()).resolves.toBe(true);

    expect(events).toEqual(['stdin', 'list', 'confirm', 'refresh', 'print']);
    expect(refreshes).toEqual([{ ...SCOPE, key: 'API_TOKEN', value }]);
    expect(adds).toEqual([]);
    expect(questions).toEqual(['Are you sure you want to replace the value of the secret API_TOKEN?']);
    expect(lines).toEqual(['✔ Secret API_TOKEN updated.']);
  });

  it('matches the key exactly, so a different case or a prefix of a held key is still an add', async () => {
    const { run, adds, refreshes } = harnessed({
      piped: randomUUID(),
      yes: true,
      held: [{ key: 'api_token', updatedAt: 'x' }, { key: 'API_TOKEN_2', updatedAt: 'x' }, { key: undefined, updatedAt: 'x' }],
    });

    await run();

    expect(adds).toHaveLength(1);
    expect(refreshes).toEqual([]);
  });

  it('S4 returns false and writes nothing when the confirmation is declined', async () => {
    const { run, events, adds, refreshes, lines } = harnessed({ isTTY: true, typed: randomUUID(), confirmed: false });

    await expect(run()).resolves.toBe(false);

    expect(events).toEqual(['prompt', 'list', 'confirm']);
    expect(adds).toEqual([]);
    expect(refreshes).toEqual([]);
    expect(lines).toEqual([]);
  });

  it.each([
    ['nothing piped', ''],
    ['a lone newline', '\n'],
    ['a lone CRLF', '\r\n'],
    ['only spaces', '   \n'],
    ['only a tab', '\t'],
  ])('S5 refuses %s with a usage error naming the key, before any API call or confirmation', async (_label, piped) => {
    const { run, events, adds, lines } = harnessed({ piped, yes: true });

    const error = (await run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('The value for API_TOKEN is empty. A secret needs a non-empty value; nothing was changed.');
    expect(events).toEqual(['stdin']);
    expect(adds).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('S5 also refuses a blank answer that reaches it from the prompt', async () => {
    const { run, events } = harnessed({ isTTY: true, typed: '  ', confirmed: true });

    await expect(run()).rejects.toThrow('The value for API_TOKEN is empty.');
    expect(events).toEqual(['prompt']);
  });

  it('keeps a value that is padded with spaces as typed, sending it unchanged', async () => {
    const padded = `  ${randomUUID()}  `;
    const { run, adds } = harnessed({ piped: `${padded}\n`, yes: true });

    await run();

    expect(adds[0].value).toBe(padded);
  });

  it('S6 fails fast when the value is piped and --yes is not given: reads nothing, lists nothing, asks nothing', async () => {
    const { run, events, adds } = harnessed({ piped: randomUUID(), yes: false });

    const error = (await run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      'Pass --yes when piping the value: standard input carries the value, so there is no way to ask for confirmation.',
    );
    expect(events).toEqual([]);
    expect(adds).toEqual([]);
  });

  it('does not need --yes on a terminal, where the confirmation can be asked', async () => {
    const { run, events } = harnessed({ isTTY: true, typed: randomUUID(), yes: false });

    await run();

    expect(events).toContain('confirm');
  });

  it.each([
    ['NEXT_PUBLIC_API'],
    ['NUXT_PUBLIC_API'],
    ['VITE_API'],
    ['GATSBY_API'],
    ['PUBLIC_API'],
  ])('S7 prints the client-exposed warning for %s before the confirmation and still writes', async (key) => {
    const { run, events, lines, adds } = harnessed({ key, piped: randomUUID(), yes: true });

    await expect(run()).resolves.toBe(true);

    expect(events).toEqual(['stdin', 'list', 'print', 'confirm', 'add', 'print']);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`Warning: ${key} starts with`);
    expect(lines[0]).toContain('inlined into client JavaScript at build time');
    expect(adds).toHaveLength(1);
  });

  it.each([['API_TOKEN'], ['MY_NEXT_PUBLIC_X']])('S7 prints no warning for %s', async (key) => {
    const { run, lines } = harnessed({ key, piped: randomUUID(), yes: true });

    await run();

    expect(lines).toEqual([`✔ Secret ${key} added.`]);
  });

  it('still prints the warning when the user then declines, and writes nothing', async () => {
    const { run, lines, adds } = harnessed({ key: 'VITE_X', isTTY: true, typed: randomUUID(), confirmed: false });

    await expect(run()).resolves.toBe(false);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Warning: VITE_X');
    expect(adds).toEqual([]);
  });

  it('colours the warning yellow and the success line green only when stdout is a terminal', async () => {
    const plain = harnessed({ key: 'VITE_X', piped: randomUUID(), yes: true });
    const drawn = harnessed({ key: 'VITE_X', piped: randomUUID(), yes: true, outputIsTTY: true });

    await plain.run();
    await drawn.run();

    expect(plain.lines.join('')).not.toContain('\u001b[');
    expect(drawn.lines[0]).toBe(`\u001b[33m${clientExposedWarning('VITE_X')}\u001b[39m`);
    expect(drawn.lines[1]).toBe('\u001b[32m✔ Secret VITE_X added.\u001b[39m');
  });

  it('propagates a failed list before asking or writing', async () => {
    const failure = new LaunchApiError(403, [{ code: 'x' }]);
    const { run, events, adds } = harnessed({ piped: randomUUID(), yes: true, listFails: failure });

    await expect(run()).rejects.toBe(failure);
    expect(events).toEqual(['stdin', 'list']);
    expect(adds).toEqual([]);
  });

  it('propagates a failed add without a success line', async () => {
    const failure = new LaunchApiError(409, [{ code: 'x' }]);
    const { run, lines } = harnessed({ piped: randomUUID(), yes: true, writeFails: failure });

    await expect(run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('propagates a failed refresh without a success line', async () => {
    const failure = new LaunchApiError(404, [{ code: 'x' }]);
    const { run, lines } = harnessed({ piped: randomUUID(), yes: true, writeFails: failure, held: [{ key: 'API_TOKEN', updatedAt: 'x' }] });

    await expect(run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('propagates a failed read of standard input before any API call', async () => {
    const failure = new Error('stdin broke');
    const { run, events } = harnessed({ yes: true, pipeFails: failure });

    await expect(run()).rejects.toBe(failure);
    expect(events).toEqual(['stdin']);
  });
});
