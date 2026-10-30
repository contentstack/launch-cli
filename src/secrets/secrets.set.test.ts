import { randomUUID } from 'node:crypto';

import type { ServiceContext } from '../core/service-context';
import { LaunchApiError } from '../transport/errors';
import { NoValueError } from './secrets.value';
import { SecretSetter } from './secrets.set';
import type { Secret } from './types';

const REQUEST = { org: 'org1', project: 'proj1', environment: 'env1', key: 'API_TOKEN' };

interface Harness {
  isTTY?: boolean;
  existing?: Secret[];
  typed?: unknown;
  piped?: string | Error;
  confirmed?: boolean;
  confirmFails?: Error;
  mutationFails?: Error;
  listFails?: Error;
}

function setterUnderTest(harness: Harness = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const prompts: Record<string, unknown>[] = [];
  const questions: string[] = [];
  const listed: unknown[] = [];
  const added: unknown[][] = [];
  const refreshed: unknown[][] = [];
  const stdinReads: number[] = [];

  const services = {
    isTTY: harness.isTTY ?? false,
    outputIsTTY: false,
    ux: {
      print: (line: string) => {
        lines.push(line);
      },
      inquire: async (payload: unknown) => {
        calls.push('prompt');
        prompts.push(payload as Record<string, unknown>);
        return harness.typed as never;
      },
    },
    api: {
      secrets: {
        list: async (params: unknown) => {
          calls.push('list');
          listed.push(params);

          if (harness.listFails) {
            throw harness.listFails;
          }

          return harness.existing ?? [];
        },
        add: async (...args: unknown[]) => {
          calls.push('add');
          added.push(args);

          if (harness.mutationFails) {
            throw harness.mutationFails;
          }

          return {};
        },
        refresh: async (...args: unknown[]) => {
          calls.push('refresh');
          refreshed.push(args);

          if (harness.mutationFails) {
            throw harness.mutationFails;
          }

          return {};
        },
      },
    },
  } as unknown as ServiceContext;

  const setter = new SecretSetter(
    services,
    async (question) => {
      calls.push('confirm');
      questions.push(question);

      if (harness.confirmFails) {
        throw harness.confirmFails;
      }

      return harness.confirmed ?? true;
    },
    async () => {
      calls.push('stdin');
      stdinReads.push(1);

      if (harness.piped instanceof Error) {
        throw harness.piped;
      }

      return harness.piped ?? '';
    },
  );

  return { setter, calls, lines, prompts, questions, listed, added, refreshed, stdinReads };
}

describe('SecretSetter', () => {
  it('adds a new secret from piped stdin after listing and confirming, never prompting for the value', async () => {
    const value = randomUUID();
    const run = setterUnderTest({ piped: value });

    const outcome = await run.setter.set(REQUEST);

    expect(outcome).toBe('added');
    expect(run.calls).toEqual(['list', 'stdin', 'confirm', 'add']);
    expect(run.listed).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(run.added).toEqual([[{ org: 'org1', project: 'proj1', environment: 'env1' }, 'API_TOKEN', value]]);
    expect(run.refreshed).toEqual([]);
    expect(run.prompts).toEqual([]);
    expect(run.questions).toEqual(['Add the secret API_TOKEN to this environment?']);
    expect(run.lines).toEqual(['✔ Secret API_TOKEN added.']);
    expect(run.lines.join('\n')).not.toContain(value);
  });

  it('asks for the value with a masked prompt on a terminal and never reads stdin', async () => {
    const value = randomUUID();
    const run = setterUnderTest({ isTTY: true, typed: value });

    await run.setter.set(REQUEST);

    expect(run.calls).toEqual(['list', 'prompt', 'confirm', 'add']);
    expect(run.prompts).toHaveLength(1);
    expect(run.prompts[0]).toMatchObject({ type: 'password', message: 'Value for API_TOKEN', mask: '*' });
    expect(run.added[0][2]).toBe(value);
    expect(run.stdinReads).toEqual([]);
  });

  it('refreshes instead of adding when the key is already listed, and sends no add', async () => {
    const value = randomUUID();
    const run = setterUnderTest({ piped: value, existing: [{ key: 'OTHER' }, { key: 'API_TOKEN' }] });

    const outcome = await run.setter.set(REQUEST);

    expect(outcome).toBe('refreshed');
    expect(run.refreshed).toEqual([[{ org: 'org1', project: 'proj1', environment: 'env1' }, 'API_TOKEN', value]]);
    expect(run.added).toEqual([]);
    expect(run.questions).toEqual([
      'Refresh the secret API_TOKEN in this environment? Its current value will be replaced.',
    ]);
    expect(run.lines).toEqual(['✔ Secret API_TOKEN refreshed.']);
  });

  it('adds when only a key that differs in case or by prefix is listed', async () => {
    const run = setterUnderTest({ piped: 'v', existing: [{ key: 'api_token' }, { key: 'API_TOKEN_2' }, {}] });

    await expect(run.setter.set(REQUEST)).resolves.toBe('added');
    expect(run.refreshed).toEqual([]);
  });

  it('sends nothing and reports a decline when the confirmation is refused', async () => {
    const run = setterUnderTest({ piped: randomUUID(), confirmed: false });

    const outcome = await run.setter.set(REQUEST);

    expect(outcome).toBe('declined');
    expect(run.calls).toEqual(['list', 'stdin', 'confirm']);
    expect(run.added).toEqual([]);
    expect(run.refreshed).toEqual([]);
    expect(run.lines).toEqual([]);
  });

  it('refuses an empty pipe before confirming or sending anything', async () => {
    const run = setterUnderTest({ piped: new NoValueError() });

    await expect(run.setter.set(REQUEST)).rejects.toBeInstanceOf(NoValueError);
    expect(run.calls).toEqual(['list', 'stdin']);
    expect(run.added).toEqual([]);
  });

  it.each(['NEXT_PUBLIC_API_URL', 'NUXT_PUBLIC_X', 'VITE_X', 'GATSBY_X', 'PUBLIC_X'])(
    'warns that %s is exposed to the client and still sends it',
    async (key) => {
      const run = setterUnderTest({ piped: 'v' });

      await run.setter.set({ ...REQUEST, key });

      expect(run.lines[0]).toContain(`Warning: ${key} starts with a client-exposed prefix`);
      expect(run.lines).toHaveLength(2);
      expect(run.calls).toEqual(['list', 'stdin', 'confirm', 'add']);
    },
  );

  it.each(['API_TOKEN', 'MY_NEXT_PUBLIC_X'])('prints no exposure warning for %s', async (key) => {
    const run = setterUnderTest({ piped: 'v' });

    await run.setter.set({ ...REQUEST, key });

    expect(run.lines).toEqual([`✔ Secret ${key} added.`]);
  });

  it('prints the exposure warning before the value is read, and also when the user then declines', async () => {
    const run = setterUnderTest({ piped: 'v', confirmed: false });

    await run.setter.set({ ...REQUEST, key: 'VITE_X' });

    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain('VITE_X');
  });

  it('keeps a value out of a failed mutation, and prints nothing as a success', async () => {
    const value = 'line1\nline2';
    const failure = new LaunchApiError(400, [{ code: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.VALUE.MULTILINE' }]);
    const run = setterUnderTest({ piped: value, mutationFails: failure });

    await expect(run.setter.set(REQUEST)).rejects.toBe(failure);
    expect(run.lines).toEqual([]);
    expect(run.lines.join('\n')).not.toContain('line1');
    expect(run.questions.join('\n')).not.toContain('line1');
  });

  it('propagates a failed list before asking for a value', async () => {
    const failure = new Error('list failed');
    const run = setterUnderTest({ listFails: failure, isTTY: true });

    await expect(run.setter.set(REQUEST)).rejects.toBe(failure);
    expect(run.calls).toEqual(['list']);
  });

  it('propagates a failed prompt', async () => {
    const run = setterUnderTest({ isTTY: true, typed: undefined });

    await expect(run.setter.set(REQUEST)).rejects.toThrow('Cancelled');
    expect(run.calls).toEqual(['list', 'prompt']);
  });

  it('propagates a failed confirm without sending', async () => {
    const failure = new Error('no terminal');
    const run = setterUnderTest({ piped: 'v', confirmFails: failure });

    await expect(run.setter.set(REQUEST)).rejects.toBe(failure);
    expect(run.added).toEqual([]);
    expect(run.refreshed).toEqual([]);
  });
});
