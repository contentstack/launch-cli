import { UxLike } from '../../../core/render';
import ProjectsList from './list';

function commandUnderTest(page: unknown, resolved: Record<string, unknown> = { org: 'org1', limit: 50, skip: 0 }) {
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
    resolved,
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

  it('renders a placeholder for a project row carrying neither a uid nor a name', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      projects: [{}],
    });

    await command.run();

    expect(lines[0]).toBe('UID  NAME  TYPE  UPDATED');
    expect(lines[1]).toBe('-    -     -     -');
  });

  it('prints only the empty-table placeholder and no pagination footer for an empty page', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 0, limit: 50, skip: 0 },
      projects: [],
    });

    await command.run();

    expect(lines).toEqual(['No records found.']);
  });

  it('pads every column to the widest row in the page', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 3, limit: 50, skip: 0 },
      projects: [
        { uid: 'a'.repeat(24), name: 'marketing-site', projectType: 'GITPROVIDER', updatedAt: '2026-09-01' },
        { uid: 'b'.repeat(24), name: 'docs', projectType: 'FILEUPLOAD', updatedAt: '2026-09-02' },
        { uid: 'c'.repeat(24), name: 'x', projectType: 'FILEUPLOAD', updatedAt: '2026-09-03' },
      ],
    });

    await command.run();

    expect(lines).toEqual([
      `UID${' '.repeat(23)}NAME            TYPE         UPDATED`,
      `${'a'.repeat(24)}  marketing-site  GITPROVIDER  2026-09-01`,
      `${'b'.repeat(24)}  docs            FILEUPLOAD   2026-09-02`,
      `${'c'.repeat(24)}  x               FILEUPLOAD   2026-09-03`,
      'Showing 1-3 of 3',
    ]);
  });

  it('passes a non-default limit and skip through to the api and reports the rows it printed', async () => {
    const { command, lines, listed } = commandUnderTest(
      {
        pagination: { count: 120, limit: 10, skip: 20 },
        projects: [{ uid: 'p1', name: 'site', projectType: 'FILEUPLOAD', updatedAt: '2026-09-01' }],
      },
      { org: 'org1', limit: 10, skip: 20 },
    );

    await command.run();

    expect(listed).toEqual([{ org: 'org1', limit: 10, skip: 20 }]);
    expect(lines[lines.length - 1]).toBe('Showing 21-21 of 120');
  });

  it('declares org as required and limit and skip as optional', () => {
    expect(ProjectsList.inputs).toEqual({ org: { required: true }, limit: {}, skip: {} });
    expect(Object.keys(ProjectsList.flags).sort()).toEqual(['limit', 'org', 'skip']);
    expect(Object.keys(ProjectsList.flags).sort()).toEqual(Object.keys(ProjectsList.inputs).sort());
  });
});
