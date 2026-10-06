import type { ApiSurface } from '../../../resources';
import { resolveInputs } from '../../../core/resolve';
import type { UxLike } from '../../../core/prompt';
import ProjectsGet from './get';

function commandUnderTest(project: unknown) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const fetched: unknown[] = [];
  const command = Object.create(ProjectsGet.prototype) as ProjectsGet;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'a'.repeat(24) },
    services: {
      ux,
      isTTY: false,
      api: {
        projects: {
          get: async (params: unknown) => {
            fetched.push(params);
            return project;
          },
        },
      },
    },
  });

  return { command, lines, fetched };
}

describe('launch:projects:get', () => {
  it('fetches the resolved project and prints its detail fields', async () => {
    const { command, lines, fetched } = commandUnderTest({
      uid: 'a'.repeat(24),
      name: 'site',
      description: 'marketing',
      projectType: 'FILEUPLOAD',
    });

    await command.run();

    expect(fetched).toEqual([{ org: 'org1', project: 'a'.repeat(24) }]);
    expect(lines).toEqual([
      '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502  NAME  \u2502  TYPE        \u2502  UID                       \u2502  DESCRIPTION  \u2502',
      '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
      '\u2502  site  \u2502  FILEUPLOAD  \u2502  aaaaaaaaaaaaaaaaaaaaaaaa  \u2502  marketing    \u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
    ]);
  });

  it('omits fields the API did not return', async () => {
    const { command, lines } = commandUnderTest({ uid: 'a'.repeat(24), name: 'site' });

    await command.run();

    expect(lines).toEqual([
      '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502  NAME  \u2502  TYPE  \u2502  UID                       \u2502  DESCRIPTION  \u2502',
      '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
      '\u2502  site  \u2502  -     \u2502  aaaaaaaaaaaaaaaaaaaaaaaa  \u2502  -            \u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
    ]);
  });

  it('renders a dash in every cell for a project carrying neither a uid nor a name', async () => {
    const { command, lines } = commandUnderTest({});

    await command.run();

    expect(lines).toEqual([
      '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502  NAME  \u2502  TYPE  \u2502  UID  \u2502  DESCRIPTION  \u2502',
      '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524',
      '\u2502  -     \u2502  -     \u2502  -    \u2502  -            \u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
    ]);
  });

  it('declares org and project as required', () => {
    expect(ProjectsGet.inputs).toEqual({ org: { required: true }, project: { required: true } });
    expect(Object.keys(ProjectsGet.flags).sort()).toEqual(['org', 'project']);
    expect(Object.keys(ProjectsGet.flags).sort()).toEqual(Object.keys(ProjectsGet.inputs).sort());
  });

  it('resolves a project name from the flag into the uid the api is called with', async () => {
    const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };
    const api = {
      projects: {
        list: async () => ({
          pagination: { count: 1, limit: 1, skip: 0 },
          projects: [{ uid: 'a'.repeat(24), name: 'site' }],
        }),
        pages: async function* () {
          yield {
            pagination: { count: 1, limit: 1, skip: 0 },
            projects: [{ uid: 'a'.repeat(24), name: 'site' }],
          };
        },
      },
    } as unknown as ApiSurface;

    const resolved = await resolveInputs(ProjectsGet.inputs, {
      parsed: { org: 'org1', project: 'site' },
      projectConfig: {},
      services: { api, ux, isTTY: false },
    });
    const { command, fetched } = commandUnderTest({ uid: 'a'.repeat(24), name: 'site' });
    Object.assign(command, { resolved });

    await command.run();

    expect(resolved.project).toBe('a'.repeat(24));
    expect(fetched).toEqual([{ org: 'org1', project: 'a'.repeat(24) }]);
  });
});
