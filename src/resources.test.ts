import { ApiSurface, DEPENDENCIES, buildApi, catalog, resolutionTable } from './resources';
import { DeploymentsApi } from './deployments/deployments.api';
import { EnvironmentsApi } from './environments/environments.api';
import { GitApi } from './git/git.api';
import { ProjectsApi } from './projects/projects.api';
import { UxLike } from './core/render';
import * as prompt from './projects/project.prompt';
import * as organizationPrompt from './organizations/organization.prompt';
import { OrganizationsApi } from './organizations/organizations.api';
import { ProjectResolver } from './projects/project.resolver';
import type { CmaSession } from './transport/cma-client';

const UNUSED_CMA: CmaSession = {
  fetchOrganizations: async () => {
    throw new Error('this test lists no organizations');
  },
  fetchOrganization: async () => {
    throw new Error('this test fetches no organization');
  },
  scopedOrganizationUid: () => undefined,
};

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
    expect(table.limit.default).toBe(100);
    expect(table.skip.default).toBe(0);
    expect(table.yes.default).toBe(false);
    expect(table.org.default).toBeUndefined();
    expect(table.project.default).toBeUndefined();
  });

  it('delegates the project prompt to the project picker with the resolved org', async () => {
    const spy = jest.spyOn(prompt, 'promptForProject').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(table.project.prompt?.({ services, resolved })).resolves.toBe(PROJECT_UID);

    expect(spy).toHaveBeenCalledWith(services, 'org1');
    spy.mockRestore();
  });

  it('delegates a project name passed on argv to the project resolver as a parsed reference', async () => {
    const spy = jest.spyOn(ProjectResolver.prototype, 'toUid').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(table.project.normalize?.('Project One', { services, resolved, source: 'flag' })).resolves.toBe(
      PROJECT_UID,
    );

    expect(spy).toHaveBeenCalledWith('org1', { kind: 'name', name: 'Project One' });
    spy.mockRestore();
  });

  it('hands the resolver a uid reference untouched when the argv value is already a uid', async () => {
    const spy = jest.spyOn(ProjectResolver.prototype, 'toUid').mockResolvedValue(PROJECT_UID);
    const { services, resolved } = args();

    await expect(table.project.normalize?.(PROJECT_UID, { services, resolved, source: 'flag' })).resolves.toBe(
      PROJECT_UID,
    );

    expect(spy).toHaveBeenCalledWith('org1', { kind: 'uid', uid: PROJECT_UID });
    spy.mockRestore();
  });

  it.each(['config', 'prompt', 'default'] as const)(
    'hands the resolver a uid reference for a value that came from %s, whatever its shape',
    async (source) => {
      const spy = jest.spyOn(ProjectResolver.prototype, 'toUid').mockResolvedValue(PROJECT_UID);
      const { services, resolved } = args();

      await expect(table.project.normalize?.('Project One', { services, resolved, source })).resolves.toBe(PROJECT_UID);

      expect(spy).toHaveBeenCalledWith('org1', { kind: 'uid', uid: 'Project One' });
      spy.mockRestore();
    },
  );

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

  it('delegates the org prompt to the organization picker and normalises nothing', async () => {
    const spy = jest.spyOn(organizationPrompt, 'promptForOrganization').mockResolvedValue('org9');
    const { services } = args();

    await expect(table.org.prompt?.({ services, resolved: {} })).resolves.toBe('org9');
    expect(spy).toHaveBeenCalledWith(services);
    expect(table.org.normalize).toBeUndefined();
    expect(table.org.dependsOn).toBeUndefined();
  });
});

describe('the api surface', () => {
  it('assembles one repository per resource from the single client', () => {
    const client = {} as never;
    const api = buildApi(client, UNUSED_CMA);

    expect(Object.keys(api).sort()).toEqual(['deployments', 'environments', 'git', 'organizations', 'projects']);
    expect(api.organizations).toBeInstanceOf(OrganizationsApi);
    expect(api.projects).toBeInstanceOf(ProjectsApi);
    expect(api.environments).toBeInstanceOf(EnvironmentsApi);
    expect(api.deployments).toBeInstanceOf(DeploymentsApi);
    expect(api.git).toBeInstanceOf(GitApi);
  });

  it('hands the organizations repository the CMA session it was given', async () => {
    const fetched: unknown[] = [];
    const cma: CmaSession = {
      fetchOrganizations: async () => ({ items: [], count: 0 }),
      fetchOrganization: async (uid) => {
        fetched.push(uid);
        return { uid, name: 'Scoped Org' };
      },
      scopedOrganizationUid: () => 'org7',
    };

    const available = await buildApi({} as never, cma).organizations.available();

    expect(fetched).toEqual(['org7']);
    expect(available).toEqual({ organizations: [{ uid: 'org7', name: 'Scoped Org' }], scoped: true });
  });

  it('contributes every resource’s flags to the one catalog', () => {
    for (const flag of ['org', 'project', 'type', 'env-name', 'framework', 'server-cmd', 'namespace', 'repo']) {
      expect(catalog).toHaveProperty(flag);
    }
  });
});
