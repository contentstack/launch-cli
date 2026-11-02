import { randomUUID } from 'node:crypto';

import type { UxLike } from '../../../core/prompt';
import type { SecretSummary } from '../../../secrets/types';
import SecretsList from './list';

const RESOLVED = { org: 'org1', project: 'proj1', env: 'env1' };

function commandUnderTest(
  answer: () => Promise<unknown>,
  { outputIsTTY = false, resolved = RESOLVED }: { outputIsTTY?: boolean; resolved?: Record<string, unknown> } = {},
) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const fetched: unknown[] = [];
  const command = Object.create(SecretsList.prototype) as SecretsList;

  Object.assign(command, {
    ux,
    resolved,
    services: {
      ux,
      outputIsTTY,
      api: {
        secrets: {
          list: async (params: unknown) => {
            fetched.push(params);
            return answer();
          },
        },
      },
    },
  });

  return { command, lines, fetched };
}

describe('launch:secrets:list', () => {
  it('lists the key and update time of each secret in a KEY and UPDATED table, never a value', async () => {
    const leaked = randomUUID();
    const secrets = [
      { key: 'API_TOKEN', updatedAt: '2026-09-01', value: leaked },
      { key: 'DB_PASSWORD', updatedAt: '2026-09-02' },
    ] as SecretSummary[];
    const { command, lines, fetched } = commandUnderTest(async () => secrets);

    await command.run();

    const output = lines.join('\n');

    expect(fetched).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(lines[1]).toBe('│  KEY          │  UPDATED     │');
    expect(lines[3]).toBe('│  API_TOKEN    │  2026-09-01  │');
    expect(lines[5]).toBe('│  DB_PASSWORD  │  2026-09-02  │');
    expect(lines).toHaveLength(7);
    expect(output).not.toContain('VALUE');
    expect(output).not.toContain(leaked);
  });

  it('shows a dash for a secret missing its key or its update time', async () => {
    const { command, lines } = commandUnderTest(async () => [{ key: undefined, updatedAt: undefined }]);

    await command.run();

    expect(lines[3]).toBe('│  -    │  -        │');
  });

  it('prints the empty-state line and no table for an environment without secrets', async () => {
    const { command, lines } = commandUnderTest(async () => []);

    await command.run();

    expect(lines).toEqual(['No secrets found in this environment.']);
  });

  it('colours the empty-state line yellow on a terminal and leaves it plain otherwise', async () => {
    const plain = commandUnderTest(async () => []);
    const tty = commandUnderTest(async () => [], { outputIsTTY: true });

    await plain.command.run();
    await tty.command.run();

    expect(plain.lines).toEqual(['No secrets found in this environment.']);
    expect(tty.lines).toEqual(['\u001b[33mNo secrets found in this environment.\u001b[39m']);
  });

  it('asks for the secrets of the resolved environment uid, not of the flag text', async () => {
    const { command, fetched } = commandUnderTest(async () => [], {
      resolved: { org: 'orgX', project: 'projX', env: 'envUidX' },
    });

    await command.run();

    expect(fetched).toEqual([{ org: 'orgX', project: 'projX', environment: 'envUidX' }]);
  });

  it('propagates a failed secrets request and prints nothing', async () => {
    const failure = new Error('list failed');
    const { command, lines } = commandUnderTest(async () => Promise.reject(failure));

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required, and no value, limit or skip input', () => {
    expect(SecretsList.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
    });
    expect(Object.keys(SecretsList.flags).sort()).toEqual(['env', 'org', 'project']);
    expect(Object.keys(SecretsList.flags).sort()).toEqual(Object.keys(SecretsList.inputs).sort());
  });
});
