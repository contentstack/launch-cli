import { REDACTED } from '../../../core/redact';
import type { UxLike } from '../../../core/prompt';
import VariablesList from './list';

const RESOLVED = { org: 'org1', project: 'proj1', env: 'env1', limit: 100, skip: 0 };

function commandUnderTest(
  environment: unknown,
  resolved: Record<string, unknown> = RESOLVED,
  answer: () => Promise<unknown> = async () => environment,
) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const fetched: unknown[] = [];
  const command = Object.create(VariablesList.prototype) as VariablesList;

  Object.assign(command, {
    ux,
    resolved,
    services: {
      ux,
      outputIsTTY: false,
      api: {
        environments: {
          get: async (params: unknown) => {
            fetched.push(params);
            return answer();
          },
        },
      },
    },
  });

  return { command, lines, fetched };
}

describe('launch:variables:list', () => {
  it('lists each key with a masked value and the environment update time, never a value', async () => {
    const { command, lines, fetched } = commandUnderTest({
      uid: 'env1',
      updatedAt: '2026-09-01',
      environmentVariables: [
        { key: 'API_KEY', value: 'never-printed-abc' },
        { key: 'API_URL', value: 'https://example.test' },
      ],
    });

    await command.run();

    const output = lines.join('\n');

    expect(fetched).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(lines[1]).toBe('│  KEY      │  VALUE   │  UPDATED     │');
    expect(lines[3]).toBe(`│  API_KEY  │  ${REDACTED}  │  2026-09-01  │`);
    expect(lines[5]).toBe(`│  API_URL  │  ${REDACTED}  │  2026-09-01  │`);
    expect(lines[lines.length - 1]).toBe('Showing 1-2 of 2');
    expect(output).toContain('API_KEY');
    expect(output).not.toContain('never-printed-abc');
    expect(output).not.toContain('https://example.test');
  });

  it('applies limit and skip to the variables and numbers the footer from skip', async () => {
    const { command, lines } = commandUnderTest(
      { environmentVariables: [{ key: 'A', value: 'a1' }, { key: 'B', value: 'b1' }, { key: 'C', value: 'c1' }] },
      { ...RESOLVED, limit: 1, skip: 1 },
    );

    await command.run();

    const output = lines.join('\n');

    expect(output).toContain('B');
    expect(output).not.toContain('│  A ');
    expect(output).not.toContain('│  C ');
    expect(lines[lines.length - 1]).toBe('Showing 2-2 of 3');
  });

  it.each([[{}], [{ environmentVariables: [] }], [{ environmentVariables: null }]])(
    'prints only the empty-table placeholder for an environment with no variables (%p)',
    async (environment) => {
      const { command, lines } = commandUnderTest(environment);

      await command.run();

      expect(lines).toEqual(['No records found.']);
    },
  );

  it('renders a placeholder for a variable that carries no key and still hides its value', async () => {
    const { command, lines } = commandUnderTest({ environmentVariables: [{ value: 'secret-value' }] });

    await command.run();

    expect(lines[3]).toBe(`│  -    │  ${REDACTED}  │  -        │`);
    expect(lines.join('\n')).not.toContain('secret-value');
  });

  it('propagates a failed environment request', async () => {
    const failure = new Error('get failed');
    const { command } = commandUnderTest(undefined, undefined, async () => Promise.reject(failure));

    await expect(command.run()).rejects.toBe(failure);
  });

  it('declares org, project and env as required and limit and skip as optional', () => {
    expect(VariablesList.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      limit: {},
      skip: {},
    });
    expect(Object.keys(VariablesList.flags).sort()).toEqual(['env', 'limit', 'org', 'project', 'skip']);
    expect(Object.keys(VariablesList.flags).sort()).toEqual(Object.keys(VariablesList.inputs).sort());
  });
});
