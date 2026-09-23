import { UxLike } from '../../../output/render';
import ProjectsList from './list';

function commandUnderTest(page: unknown) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const listed: unknown[] = [];
  const command = Object.create(ProjectsList.prototype) as ProjectsList;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', limit: 50, skip: 0 },
    services: {
      ux,
      isTTY: false,
      api: {
        projects: {
          list: async (params: unknown) => {
            listed.push(params);
            return page;
          },
        },
      },
    },
  });

  return { command, lines, listed };
}

describe('launch:projects:list', () => {
  it('lists the org projects as a table with a pagination footer', async () => {
    const { command, lines, listed } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      projects: [{ uid: 'p1', name: 'site', projectType: 'FILEUPLOAD', updatedAt: '2026-09-01T00:00:00.000Z' }],
    });

    await command.run();

    expect(listed).toEqual([{ org: 'org1', limit: 50, skip: 0 }]);
    expect(lines[0]).toBe('UID  NAME  TYPE        UPDATED');
    expect(lines[1]).toBe('p1   site  FILEUPLOAD  2026-09-01T00:00:00.000Z');
    expect(lines[2]).toBe('Showing 1-1 of 1');
  });

  it('renders placeholders for a project missing optional fields', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      projects: [{ uid: 'p1', name: 'site' }],
    });

    await command.run();

    expect(lines[1]).toBe('p1   site  -     -');
  });

  it('declares org as required and limit and skip as optional', () => {
    expect(ProjectsList.inputs).toEqual({ org: { required: true }, limit: {}, skip: {} });
    expect(Object.keys(ProjectsList.flags).sort()).toEqual(['limit', 'org', 'skip']);
    expect(Object.keys(ProjectsList.flags).sort()).toEqual(Object.keys(ProjectsList.inputs).sort());
  });
});
