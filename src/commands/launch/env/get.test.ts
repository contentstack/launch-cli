import type { UxLike } from '../../../core/prompt';
import EnvironmentsGet from './get';

function commandUnderTest(answer: () => Promise<unknown>, projectType = 'GITPROVIDER') {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const fetched: unknown[] = [];
  const command = Object.create(EnvironmentsGet.prototype) as EnvironmentsGet;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1' },
    services: {
      ux,
      isTTY: false,
      outputIsTTY: false,
      api: {
        projects: { get: async () => ({ uid: 'proj1', projectType }) },
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

describe('launch:env:get', () => {
  it('fetches the resolved environment and prints its fields as a FIELD | VALUE table', async () => {
    const { command, lines, fetched } = commandUnderTest(async () => ({ uid: 'env1', name: 'production' }));

    await command.run();

    expect(fetched).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1' }]);
    expect(lines[1]).toBe('│  FIELD                        │  VALUE       │');
    expect(lines[3]).toBe('│  ENVIRONMENT UID              │  env1        │');
    expect(lines[5]).toBe('│  NAME                         │  production  │');
    expect(lines).toHaveLength(39);
  });

  it('leaves the branch row out for an environment of a file-upload project', async () => {
    const { command, lines } = commandUnderTest(async () => ({ uid: 'env1', gitBranch: 'main' }), 'FILEUPLOAD');

    await command.run();

    expect(lines.some((line) => line.includes('BRANCH'))).toBe(false);
    expect(lines).toHaveLength(37);
  });

  it('propagates a failed lookup', async () => {
    const failure = new Error('not found');
    const { command, lines } = commandUnderTest(async () => Promise.reject(failure));

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required inputs', () => {
    expect(EnvironmentsGet.inputs).toEqual({ org: { required: true }, project: { required: true }, env: { required: true } });
    expect(Object.keys(EnvironmentsGet.flags).sort()).toEqual(['env', 'org', 'project']);
  });

  it('shows the project it resolved in the PROJECT row, not the project field the API returns', async () => {
    const { command, lines } = commandUnderTest(async () => ({ uid: 'env1', name: 'production', project: 'regenerated' }));

    await command.run();

    const project = lines.find((line) => line.startsWith('\u2502  PROJECT '));
    expect(project).toContain('proj1');
    expect(project).not.toContain('regenerated');
  });
});
