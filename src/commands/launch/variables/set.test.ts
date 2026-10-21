import type { UxLike } from '../../../core/prompt';
import { aliasRequiresFromStack } from '../../../variables/variable.rules';
import { VariableSetter } from '../../../variables/variable.set';
import VariablesSet from './set';

function commandUnderTest(resolved: Record<string, unknown>, files: Record<string, string> = {}) {
  const lines: string[] = [];
  const updates: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const command = Object.create(VariablesSet.prototype) as VariablesSet;

  Object.assign(command, {
    ux,
    resolved,
    dataDir: '/work',
    services: {
      ux,
      isTTY: false,
      outputIsTTY: false,
      api: {
        environments: {
          get: async () => ({ environmentVariables: [] }),
          update: async (params: unknown) => {
            updates.push(params);
            return {};
          },
        },
      },
    },
  });

  return { command, lines, updates, files };
}

describe('launch:variables:set', () => {
  it('sets the --var pairs through the environment endpoints and prints the provenance', async () => {
    const { command, lines, updates } = commandUnderTest({ org: 'o', project: 'p', env: 'e', var: ['A=1', 'B=2'] });

    await command.run();

    expect(updates).toEqual([
      { org: 'o', project: 'p', environment: 'e', update: { environmentVariables: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] } },
    ]);
    expect(lines).toEqual(['✔ 2 variables set — 2 from --var']);
  });

  it('hands --from-stack and --alias, the data directory and every source flag to the setter', async () => {
    const requests: unknown[] = [];
    jest.spyOn(VariableSetter.prototype, 'set').mockImplementation(async (request) => {
      requests.push(request);
    });

    const { command } = commandUnderTest({
      org: 'o',
      project: 'p',
      env: 'e',
      var: ['A=1'],
      dotenv: ['a.env'],
      'from-stack': true,
      alias: 'my-prod',
    });

    await command.run();

    expect(requests).toEqual([
      {
        org: 'o',
        project: 'p',
        environment: 'e',
        vars: ['A=1'],
        envFiles: ['a.env'],
        fromStack: true,
        alias: 'my-prod',
        dataDir: '/work',
      },
    ]);
  });

  it('propagates a malformed --var as a usage error before any request', async () => {
    const { command, updates } = commandUnderTest({ org: 'o', project: 'p', env: 'e', var: ['A='] });

    await expect(command.run()).rejects.toThrow('A has an empty value.');
    expect(updates).toEqual([]);
  });

  it('declares org, project and env as required and the two source flags as optional', () => {
    expect(VariablesSet.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      var: {},
      dotenv: {},
      'from-stack': {},
      alias: {},
    });
    expect(Object.keys(VariablesSet.flags).sort()).toEqual(['alias', 'dotenv', 'env', 'from-stack', 'org', 'project', 'var']);
    expect(VariablesSet.rules).toEqual([aliasRequiresFromStack]);
    expect(Object.keys(VariablesSet.flags).sort()).toEqual(Object.keys(VariablesSet.inputs).sort());
  });
});
