import { randomUUID } from 'node:crypto';

import type { UxLike } from '../../../core/prompt';
import SecretsList from './list';

const RESOLVED = { org: 'org1', project: 'proj1', env: 'env1' };

function commandUnderTest(
  secrets: unknown,
  answer: () => Promise<unknown> = async () => secrets,
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
    resolved: RESOLVED,
    services: {
      ux,
      outputIsTTY: false,
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
  it('lists each secret with its key and update time under KEY and UPDATED and nothing else', async () => {
    const { command, lines, fetched } = commandUnderTest([
      { key: 'API_TOKEN', updatedAt: '2026-09-01' },
      { key: 'DB_URL', updatedAt: '2026-09-02' },
    ]);

    await command.run();

    expect(fetched).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(lines[1]).toBe('│  KEY        │  UPDATED     │');
    expect(lines[3]).toBe('│  API_TOKEN  │  2026-09-01  │');
    expect(lines[5]).toBe('│  DB_URL     │  2026-09-02  │');
    expect(lines).toHaveLength(7);
    expect(lines.join('\n')).not.toMatch(/VALUE/i);
  });

  it('prints a value that the repository handed back in no table row', async () => {
    const value = randomUUID();
    const { command, lines } = commandUnderTest([{ key: 'API_TOKEN', updatedAt: '2026-09-01', value }]);

    await command.run();

    expect(lines.join('\n')).toContain('API_TOKEN');
    expect(lines.join('\n')).not.toContain(value);
  });

  it('prints only the empty-table placeholder for an environment with no secrets', async () => {
    const { command, lines } = commandUnderTest([]);

    await command.run();

    expect(lines).toEqual(['No records found.']);
  });

  it('renders a placeholder for a secret that carries no key or update time', async () => {
    const { command, lines } = commandUnderTest([{}]);

    await command.run();

    expect(lines[3]).toBe('│  -    │  -        │');
  });

  it('propagates a failed secrets request', async () => {
    const failure = new Error('list failed');
    const { command, lines } = commandUnderTest(undefined, async () => Promise.reject(failure));

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required and no other flag', () => {
    expect(SecretsList.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
    });
    expect(Object.keys(SecretsList.flags).sort()).toEqual(['env', 'org', 'project']);
  });
});
