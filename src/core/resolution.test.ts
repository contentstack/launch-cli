import { ApiSurface } from '../resources';
import { UxLike } from './render';
import * as select from '../projects/project.prompt';
import { DEPENDENCIES, catalog, resolutionTable } from '../resources';

const table = resolutionTable;

const PROJECT_UID = 'a'.repeat(24);

function args() {
  const ux: UxLike = { print: () => undefined, inquire: async () => PROJECT_UID as never };
  const api = {
    projects: {
      list: async () => ({
        pagination: { count: 1, limit: 1, skip: 0 },
        projects: [{ uid: PROJECT_UID, name: 'Project One' }],
      }),
      pages: async function* () {
        yield {
          pagination: { count: 1, limit: 1, skip: 0 },
          projects: [{ uid: PROJECT_UID, name: 'Project One' }],
        };
      },
    },
  } as unknown as ApiSurface;

  return { services: { api, ux, isTTY: true }, resolved: { org: 'org1' } };
}

describe('resolution', () => {
  it('declares a rule for every catalog flag and no rule for anything else', () => {
    expect(Object.keys(table).sort()).toEqual(Object.keys(catalog).sort());
  });

  it('does not silently pass when a catalog flag is missing a resolution entry', () => {
    const incomplete = { ...table } as Record<string, unknown>;
    delete incomplete.skip;

    expect(Object.keys(incomplete).sort()).not.toEqual(Object.keys(catalog).sort());
  });

  it('does not silently pass when resolution has an entry the catalog does not', () => {
    const withExtra = { ...table, bogus: {} } as Record<string, unknown>;

    expect(Object.keys(withExtra).sort()).not.toEqual(Object.keys(catalog).sort());
  });

  it('reads org from organizationUid and project from uid in the config file', () => {
    expect(table.org.configPath).toBe('organizationUid');
    expect(table.project.configPath).toBe('uid');
  });

  it('declares no config path for the flags that only ever come from the command line', () => {
    expect(table.limit.configPath).toBeUndefined();
    expect(table.skip.configPath).toBeUndefined();
    expect(table.yes.configPath).toBeUndefined();
    expect(table.config.configPath).toBeUndefined();
    expect(table['data-dir'].configPath).toBeUndefined();
  });

  it('declares the paging and confirmation defaults and no default for the rest', () => {
    expect(table.limit.default).toBe(50);
    expect(table.skip.default).toBe(0);
    expect(table.yes.default).toBe(false);
    expect(table.org.default).toBeUndefined();
    expect(table.project.default).toBeUndefined();
  });

  it('delegates the project prompt to the project selector with the resolved org', async () => {
    const spy = jest.spyOn(select, 'promptForProject').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(table.project.prompt?.({ services, resolved })).resolves.toBe(PROJECT_UID);

    expect(spy).toHaveBeenCalledWith(services, 'org1');
    spy.mockRestore();
  });

  it('delegates project normalisation to the project selector with the resolved org', async () => {
    const spy = jest.spyOn(select, 'resolveProjectUid').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(table.project.normalize?.('Project One', { services, resolved })).resolves.toBe(PROJECT_UID);

    expect(spy).toHaveBeenCalledWith(services, 'org1', 'Project One');
    spy.mockRestore();
  });

  it('declares project as depending on org so the order of the literal cannot matter', () => {
    expect(table.project.dependsOn).toEqual(['org']);
    expect(table.project.dependsOn).toBe(DEPENDENCIES.project);
  });

  it('declares no dependency for any flag other than project', () => {
    const withDependencies = Object.entries(table)
      .filter(([, spec]) => spec.dependsOn !== undefined)
      .map(([key]) => key);

    expect(withDependencies).toEqual(['project']);
    expect(Object.keys(DEPENDENCIES)).toEqual(['project']);
  });

  it('declares no prompt or normalize for org', () => {
    expect(table.org.prompt).toBeUndefined();
    expect(table.org.normalize).toBeUndefined();
  });
});
