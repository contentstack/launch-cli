import type { UxLike } from '../../../core/prompt';
import DeploymentsList from './list';

function commandUnderTest(options: {
  page?: unknown;
  resolved?: Record<string, unknown>;
  projectType?: string;
  outputIsTTY?: boolean;
  projectFailure?: Error;
  listFailure?: Error;
}) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const projectCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const command = Object.create(DeploymentsList.prototype) as DeploymentsList;

  Object.assign(command, {
    ux,
    resolved: options.resolved ?? { org: 'org1', project: 'proj1', env: 'env1', limit: 50, skip: 0 },
    services: {
      ux,
      isTTY: false,
      outputIsTTY: options.outputIsTTY ?? false,
      api: {
        projects: {
          get: async (params: unknown) => {
            projectCalls.push(params);

            if (options.projectFailure) {
              throw options.projectFailure;
            }

            return { uid: 'proj1', projectType: options.projectType ?? 'GITPROVIDER' };
          },
        },
        deployments: {
          list: async (params: unknown) => {
            listCalls.push(params);

            if (options.listFailure) {
              throw options.listFailure;
            }

            return options.page;
          },
        },
      },
    },
  });

  return { command, lines, projectCalls, listCalls };
}

const GIT_PAGE = {
  pagination: { count: 2 },
  deployments: [
    { uid: 'd1', status: 'LIVE', gitBranch: 'main', commitHash: 'abcdef0123456789', updatedAt: '2026-09-01' },
    { uid: 'd2', status: 'FAILED', gitBranch: 'develop', commitHash: '1234567abcdef', updatedAt: '2026-09-02' },
  ],
};

describe('launch:deployments:list', () => {
  it('lists the deployments of the resolved environment as a table with a pagination footer', async () => {
    const { command, lines, projectCalls, listCalls } = commandUnderTest({ page: GIT_PAGE });

    await command.run();

    expect(projectCalls).toEqual([{ org: 'org1', project: 'proj1' }]);
    expect(listCalls).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', limit: 50, skip: 0 }]);
    expect(lines[1]).toBe('│  DEPLOYMENT UID  │  STATUS  │  COMMIT   │  UPDATED     │  BRANCH   │');
    expect(lines[3]).toBe('│  d1              │  LIVE    │  abcdef0  │  2026-09-01  │  main     │');
    expect(lines[5]).toBe('│  d2              │  FAILED  │  1234567  │  2026-09-02  │  develop  │');
    expect(lines[7]).toBe('Showing 1-2 of 2');
  });

  it('leaves the commit and branch columns out for a file-upload project', async () => {
    const { command, lines } = commandUnderTest({ page: GIT_PAGE, projectType: 'FILEUPLOAD' });

    await command.run();

    expect(lines[1]).toBe('│  DEPLOYMENT UID  │  STATUS  │  UPDATED     │');
    expect(lines.join('\n')).not.toContain('BRANCH');
    expect(lines.join('\n')).not.toContain('COMMIT');
    expect(lines.join('\n')).not.toContain('abcdef0');
    expect(lines.join('\n')).not.toContain('develop');
  });

  it('numbers the footer from the --skip the command was given, never from the response', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ uid: `d${index}`, status: 'LIVE' }));
    const { command, lines } = commandUnderTest({
      page: { pagination: { count: 25, skip: 99 }, deployments: rows },
      resolved: { org: 'org1', project: 'proj1', env: 'env1', limit: 10, skip: 10 },
    });

    await command.run();

    expect(lines[lines.length - 1]).toBe('Showing 11-20 of 25');
  });

  it.each([
    [true, '\u001b[33mNo records found.\u001b[39m'],
    [false, 'No records found.'],
  ])('prints No records found. for an empty list and no footer (terminal: %s)', async (outputIsTTY, line) => {
    const { command, lines } = commandUnderTest({ page: { pagination: { count: 0 }, deployments: [] }, outputIsTTY });

    await command.run();

    expect(lines).toEqual([line]);
  });

  it('skips an entry with no uid and shows a dash for a status the rest of the entries lack', async () => {
    const { command, lines } = commandUnderTest({
      page: {
        pagination: { count: 3 },
        deployments: [{ status: 'LIVE' }, { uid: '  ', status: 'LIVE' }, { uid: 'd7' }],
      },
    });

    await command.run();

    const rows = lines.filter((line) => line.startsWith('│') && !line.includes('DEPLOYMENT UID'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('d7');
    expect(rows[0]).toContain('-');
    expect(rows[0]).not.toContain('LIVE');
    expect(lines[lines.length - 1]).toBe('Showing 1-1 of 3');
  });

  it('prints No records found. rather than a table when every entry lacks a uid', async () => {
    const { command, lines } = commandUnderTest({
      page: { pagination: { count: 1 }, deployments: [{ status: 'LIVE' }] },
    });

    await command.run();

    expect(lines).toEqual(['No records found.']);
  });

  it('propagates the project lookup failure as the same instance and lists nothing', async () => {
    const failure = new Error('project 500');
    const { command, lines, listCalls } = commandUnderTest({ page: GIT_PAGE, projectFailure: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
    expect(listCalls).toEqual([]);
  });

  it('propagates the list failure as the same instance and prints nothing', async () => {
    const failure = new Error('list 500');
    const { command, lines } = commandUnderTest({ page: GIT_PAGE, listFailure: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(lines).toEqual([]);
  });

  it('declares org, project and env as required inputs with limit and skip, and exactly those flags', () => {
    expect(DeploymentsList.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      limit: {},
      skip: {},
    });
    expect(Object.keys(DeploymentsList.flags).sort()).toEqual(['env', 'limit', 'org', 'project', 'skip']);
  });
});
