import type { UxLike } from '../../../core/prompt';
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
    expect(lines[1]).toBe('\u2502  NAME  \u2502  TYPE        \u2502  UID  \u2502');
    expect(lines[3]).toBe('\u2502  site  \u2502  FILEUPLOAD  \u2502  p1   \u2502');
    expect(lines[5]).toBe('Showing 1-1 of 1');
  });

  it('renders placeholders for a project missing optional fields', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      projects: [{ uid: 'p1', name: 'site' }],
    });

    await command.run();

    expect(lines[3]).toBe('\u2502  site  \u2502  -     \u2502  p1   \u2502');
  });

  it('renders a placeholder for a project row carrying neither a uid nor a name', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      projects: [{}],
    });

    await command.run();

    expect(lines[1]).toBe('\u2502  NAME  \u2502  TYPE  \u2502  UID  \u2502');
    expect(lines[3]).toBe('\u2502  -     \u2502  -     \u2502  -    \u2502');
  });

  it('prints only the empty-table placeholder and no pagination footer for an empty page', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 0, limit: 50, skip: 0 },
      projects: [],
    });

    await command.run();

    expect(lines).toEqual(['No records found.']);
  });

  it('sizes every column to the widest row in the page', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 3, limit: 50, skip: 0 },
      projects: [
        { uid: 'a'.repeat(24), name: 'marketing-site', projectType: 'GITPROVIDER', updatedAt: '2026-09-01' },
        { uid: 'b'.repeat(24), name: 'docs', projectType: 'FILEUPLOAD', updatedAt: '2026-09-02' },
        { uid: 'c'.repeat(24), name: 'x', projectType: 'FILEUPLOAD', updatedAt: '2026-09-03' },
      ],
    });

    await command.run();

    expect(lines[1]).toBe(`\u2502  NAME            \u2502  TYPE         \u2502  UID${' '.repeat(23)}\u2502`);
    expect(lines[3]).toBe(`\u2502  marketing-site  \u2502  GITPROVIDER  \u2502  ${'a'.repeat(24)}  \u2502`);
    expect(lines[5]).toBe(`\u2502  docs            \u2502  FILEUPLOAD   \u2502  ${'b'.repeat(24)}  \u2502`);
    expect(lines[7]).toBe(`\u2502  x               \u2502  FILEUPLOAD   \u2502  ${'c'.repeat(24)}  \u2502`);
    expect(lines[9]).toBe('Showing 1-3 of 3');
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
