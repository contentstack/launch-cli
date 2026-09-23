import { UsageError } from '../../../core/errors';
import { UxLike } from '../../../core/render';
import { resolveInputs } from '../../../core/resolve';
import { ApiSurface } from '../../../resources';
import { Project } from '../../../projects/types';
import ProjectsUpdate from './update';

const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';

function commandUnderTest(resolved: Record<string, unknown>, updated?: Partial<Project>, failure?: Error) {
  const lines: string[] = [];
  const sent: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const command = Object.create(ProjectsUpdate.prototype) as ProjectsUpdate;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: PROJECT_UID, ...resolved },
    services: {
      ux,
      isTTY: false,
      api: {
        projects: {
          update: async (params: unknown) => {
            sent.push(params);

            if (failure) {
              throw failure;
            }

            return updated ?? { uid: PROJECT_UID, name: 'Renamed Site' };
          },
        },
      },
    },
  });

  return { command, lines, sent };
}

function fakeServices() {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };
  return { api: {} as ApiSurface, ux, isTTY: false };
}

describe('launch:projects:update', () => {
  it('sends only the name it was given and reports the field that changed', async () => {
    const { command, lines, sent } = commandUnderTest({ name: 'Renamed Site', description: undefined });

    await command.run();

    expect(sent).toEqual([{ org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site' } }]);
    expect(lines).toEqual(['✔ name updated to "Renamed Site"']);
  });

  it('sends only the description it was given and reports that field', async () => {
    const { command, lines, sent } = commandUnderTest({ name: undefined, description: 'A new blurb' }, {
      uid: PROJECT_UID,
      name: 'sample-project',
      description: 'A new blurb',
    });

    await command.run();

    expect(sent).toEqual([{ org: 'org1', project: PROJECT_UID, update: { description: 'A new blurb' } }]);
    expect(lines).toEqual(['✔ description updated to "A new blurb"']);
  });

  it('sends both fields and prints one line each when both were given', async () => {
    const { command, lines, sent } = commandUnderTest({ name: 'Renamed Site', description: 'A new blurb' }, {
      uid: PROJECT_UID,
      name: 'Renamed Site',
      description: 'A new blurb',
    });

    await command.run();

    expect(sent).toEqual([
      { org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site', description: 'A new blurb' } },
    ]);
    expect(lines).toEqual(['✔ name updated to "Renamed Site"', '✔ description updated to "A new blurb"']);
  });

  it('reports the value the API confirmed rather than the one that was requested', async () => {
    const { command, lines } = commandUnderTest({ name: 'Renamed Site', description: undefined }, {
      uid: PROJECT_UID,
      name: 'renamed-site',
    });

    await command.run();

    expect(lines).toEqual(['✔ name updated to "renamed-site"']);
  });

  it('propagates an API failure rather than reporting an update that did not happen', async () => {
    const failure = new Error('update exploded');
    const { command, lines } = commandUnderTest({ name: 'Renamed Site' }, undefined, failure);

    await expect(command.run()).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it('exits 2 before sending anything when neither --name nor --description was supplied', async () => {
    const error = (await resolveInputs(ProjectsUpdate.inputs, {
      parsed: { org: 'org1', project: PROJECT_UID },
      projectConfig: {},
      services: fakeServices(),
      rules: ProjectsUpdate.rules,
    }).catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('Pass at least one of --name, --description; none was supplied.');
  });

  it('accepts a resolution carrying only one of the two updatable fields', async () => {
    await expect(
      resolveInputs(ProjectsUpdate.inputs, {
        parsed: { org: 'org1', project: PROJECT_UID, description: 'A new blurb' },
        projectConfig: {},
        services: fakeServices(),
        rules: ProjectsUpdate.rules,
      }),
    ).resolves.toMatchObject({ description: 'A new blurb', name: undefined });
  });

  it('rejects a name over the server limit as a usage error before sending', async () => {
    const error = (await resolveInputs(ProjectsUpdate.inputs, {
      parsed: { org: 'org1', project: PROJECT_UID, name: 'n'.repeat(201) },
      projectConfig: {},
      services: fakeServices(),
      rules: ProjectsUpdate.rules,
    }).catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('--name must be 200 characters or fewer; that value is 201 characters.');
  });

  it('declares org and project as required, name and description as optional', () => {
    expect(ProjectsUpdate.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      name: {},
      description: {},
    });
    expect(Object.keys(ProjectsUpdate.flags).sort()).toEqual(['description', 'name', 'org', 'project']);
    expect(Object.keys(ProjectsUpdate.flags).sort()).toEqual(Object.keys(ProjectsUpdate.inputs).sort());
  });

  it('declares no --json flag and no json mode', () => {
    expect(Object.keys(ProjectsUpdate.flags)).not.toContain('json');
    expect((ProjectsUpdate as unknown as { enableJsonFlag?: boolean }).enableJsonFlag).toBeFalsy();
  });
});
