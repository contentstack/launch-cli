import { ApiSurface } from '../api';
import { UxLike } from '../output/render';
import * as select from '../select/project';
import { catalog } from './catalog';
import { resolution } from './resolution';

const PROJECT_UID = 'a'.repeat(24);

function args() {
  const ux: UxLike = { print: () => undefined, inquire: async () => PROJECT_UID as never };
  const api = {
    projects: {
      list: async () => ({
        pagination: { count: 1, limit: 1, skip: 0 },
        projects: [{ uid: PROJECT_UID, name: 'Project One' }],
      }),
    },
  } as unknown as ApiSurface;

  return { services: { api, ux, isTTY: true }, resolved: { org: 'org1' } };
}

describe('resolution', () => {
  it('declares a rule for every catalog flag and no rule for anything else', () => {
    expect(Object.keys(resolution).sort()).toEqual(Object.keys(catalog).sort());
  });

  it('does not silently pass when a catalog flag is missing a resolution entry', () => {
    const incomplete = { ...resolution } as Record<string, unknown>;
    delete incomplete.skip;

    expect(Object.keys(incomplete).sort()).not.toEqual(Object.keys(catalog).sort());
  });

  it('does not silently pass when resolution has an entry the catalog does not', () => {
    const withExtra = { ...resolution, bogus: {} } as Record<string, unknown>;

    expect(Object.keys(withExtra).sort()).not.toEqual(Object.keys(catalog).sort());
  });

  it('reads org from organizationUid and project from uid in the config file', () => {
    expect(resolution.org.configPath).toBe('organizationUid');
    expect(resolution.project.configPath).toBe('uid');
  });

  it('declares no config path for the flags that only ever come from the command line', () => {
    expect(resolution.limit.configPath).toBeUndefined();
    expect(resolution.skip.configPath).toBeUndefined();
    expect(resolution.yes.configPath).toBeUndefined();
    expect(resolution.config.configPath).toBeUndefined();
    expect(resolution['data-dir'].configPath).toBeUndefined();
  });

  it('declares the paging and confirmation defaults and no default for the rest', () => {
    expect(resolution.limit.default).toBe(50);
    expect(resolution.skip.default).toBe(0);
    expect(resolution.yes.default).toBe(false);
    expect(resolution.org.default).toBeUndefined();
    expect(resolution.project.default).toBeUndefined();
  });

  it('delegates the project prompt to the project selector with the resolved org', async () => {
    const spy = jest.spyOn(select, 'promptForProject').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(resolution.project.prompt?.({ services, resolved })).resolves.toBe(PROJECT_UID);

    expect(spy).toHaveBeenCalledWith(services, 'org1');
    spy.mockRestore();
  });

  it('delegates project normalisation to the project selector with the resolved org', async () => {
    const spy = jest.spyOn(select, 'resolveProjectUid').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(resolution.project.normalize?.('Project One', { services, resolved })).resolves.toBe(PROJECT_UID);

    expect(spy).toHaveBeenCalledWith(services, 'org1', 'Project One');
    spy.mockRestore();
  });

  it('declares no prompt or normalize for org', () => {
    expect(resolution.org.prompt).toBeUndefined();
    expect(resolution.org.normalize).toBeUndefined();
  });
});
