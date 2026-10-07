import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import { SRC, filesUnder, productionSources } from '../support/sources';

const LAYERS = ['core', 'transport'];
const NOT_RESOURCES = [...LAYERS, 'commands'];
const RESOURCES = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !NOT_RESOURCES.includes(entry.name))
  .map((entry) => entry.name);

const RESOURCE_EDGES: Record<string, string[]> = {
  projects: ['environments', 'deployments', 'git'],
  functions: [],
  environments: [],
  deployments: [],
  git: [],
  organizations: [],
};

function sourceFilesIn(layer: string): string[] {
  return filesUnder(layer);
}

function importedPaths(relativePath: string): string[] {
  const contents = readFileSync(join(SRC, relativePath), 'utf8');
  return [...contents.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
}

function resourceOf(specifier: string, fromDirectory: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const head = posix.normalize(posix.join(fromDirectory, specifier)).split('/')[0];

  return RESOURCES.includes(head) ? head : undefined;
}

function directoryOf(relativePath: string): string {
  return posix.dirname(relativePath);
}

function crossResourceEdges(relativePath: string): string[] {
  const directory = directoryOf(relativePath);
  const owner = directory.split('/')[0];

  return importedPaths(relativePath)
    .map((specifier) => resourceOf(specifier, directory))
    .filter((target): target is string => target !== undefined && target !== owner);
}

function commandEdgesOf(relativePath: string, specifiers: string[]): string[] {
  const owner = relativePath.split('/')[2];
  const directory = directoryOf(relativePath);
  const allowed = RESOURCE_EDGES[owner] ?? [];

  return specifiers
    .map((specifier) => resourceOf(specifier, directory))
    .filter((target): target is string => target !== undefined && target !== owner && !allowed.includes(target));
}

function commandEdges(relativePath: string): string[] {
  return commandEdgesOf(relativePath, importedPaths(relativePath));
}

function resourceImports(relativePath: string): string[] {
  return importedPaths(relativePath).filter((specifier) =>
    RESOURCES.some((resource) => specifier.startsWith(`../${resource}/`) || specifier === `../${resource}`),
  );
}

describe('layering', () => {
  it.each(LAYERS.flatMap((layer) => filesUnder(layer, true)))('%s imports no resource directly', (relativePath) => {
    expect(resourceImports(relativePath)).toEqual([]);
  });

  it('finds the layer sources it claims to be checking', () => {
    expect(sourceFilesIn('core').length).toBeGreaterThan(0);
    expect(sourceFilesIn('transport').length).toBeGreaterThan(0);
  });

  it('checks the test files in core and transport too, not only the production ones', () => {
    const checked = LAYERS.flatMap((layer) => filesUnder(layer, true));

    expect(checked).toContain('core/launch-command.test.ts');
    expect(checked.filter((path) => path.endsWith('.test.ts')).length).toBeGreaterThan(0);
  });

  it('reports a resource import when one is present, so the check cannot pass vacuously', () => {
    const contrived = importedPaths('projects/project.inputs.ts');

    expect(contrived).toContain('../core/resolution');
    expect(
      ['../projects/types', './types'].filter((specifier) =>
        RESOURCES.some((resource) => specifier.startsWith(`../${resource}/`)),
      ),
    ).toEqual(['../projects/types']);
  });
});

describe('layering between resources', () => {
  it('finds no resource source reaching a resource its allow-list does not name', () => {
    const checked = RESOURCES.flatMap((resource) => sourceFilesIn(resource));
    const violations = checked.flatMap((relativePath) => {
      const owner = relativePath.split('/')[0];

      return crossResourceEdges(relativePath)
        .filter((target) => !RESOURCE_EDGES[owner].includes(target))
        .map((target) => `${relativePath} -> ${target}`);
    });

    expect(checked).toContain('projects/project.create.ts');
    expect(checked).toContain('organizations/organizations.api.ts');
    expect(checked.filter((path) => path.endsWith('.test.ts'))).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('declares an allow-list entry for every resource and invents none', () => {
    expect(RESOURCES.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(RESOURCE_EDGES).sort()).toEqual([...RESOURCES].sort());
    for (const targets of Object.values(RESOURCE_EDGES)) {
      for (const target of targets) {
        expect(RESOURCES).toContain(target);
      }
    }
  });

  it('records the edges the projects resource really uses, and no others', () => {
    expect(RESOURCE_EDGES.projects).toEqual(['environments', 'deployments', 'git']);

    expect([...new Set(sourceFilesIn('projects').flatMap((path) => crossResourceEdges(path)))].sort()).toEqual([
      'deployments',
      'environments',
      'git',
    ]);
  });

  it('reports a disallowed edge rather than passing vacuously', () => {
    const owner = 'git';

    expect(crossResourceEdges('projects/project.create.ts').length).toBeGreaterThan(0);
    expect(RESOURCE_EDGES[owner]).not.toContain('projects');
    expect(resourceOf('../projects/types', 'git')).toBe('projects');
  });
});

describe('layering of the command files', () => {
  it.each(filesUnder('commands/launch', true).filter((path) => path.split('/').length > 3))(
    '%s reaches only its own resource and the resources that one may use',
    (relativePath) => {
      expect(commandEdges(relativePath)).toEqual([]);
    },
  );

  it('finds the command files it claims to be checking', () => {
    const checked = filesUnder('commands/launch', true).filter((path) => path.split('/').length > 3);

    expect(checked).toContain('commands/launch/projects/create.ts');
    expect(checked).toContain('commands/launch/functions/serve.ts');
  });

  it('reports a command reaching another resource rather than passing vacuously', () => {
    expect(resourceOf('../../../deployments/deployment.watcher', 'commands/launch/projects')).toBe(
      'deployments',
    );
    expect(resourceOf('../../../projects/project.create', 'commands/launch/projects')).toBe('projects');
    expect(commandEdgesOf('commands/launch/projects/create.ts', ['../../../deployments/deployment.watcher'])).toEqual(
      [],
    );
    expect(commandEdgesOf('commands/launch/projects/create.ts', ['../../../organizations/organizations.api'])).toEqual([
      'organizations',
    ]);
    expect(commandEdgesOf('commands/launch/functions/serve.ts', ['../../../projects/project.create'])).toEqual([
      'projects',
    ]);
  });
});

const READS_RESOURCES = ['core/inputs.ts', 'core/launch-command.ts', 'core/resolve.ts', 'core/service-context.ts'];
const LOOP_TARGETS = [...READS_RESOURCES, 'resources.ts'];

function isEntryPoint(relativePath: string): boolean {
  return relativePath === 'index.ts' || relativePath.startsWith('commands/');
}

function runtimeImports(text: string): string[] {
  return [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+'([^']+)'/gm)].map((match) => match[1]);
}

function readsResourcesImports(relativePath: string, text: string): string[] {
  const directory = posix.dirname(relativePath);

  return runtimeImports(text)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => `${posix.normalize(posix.join(directory, specifier))}.ts`)
    .filter((target) => LOOP_TARGETS.includes(target));
}

describe('import loops through resources.ts', () => {
  it('keeps everything resources.ts loads from importing resources.ts, or a core file that reads it', () => {
    const violations = productionSources()
      .filter((source) => !isEntryPoint(source.path) && !READS_RESOURCES.includes(source.path))
      .flatMap((source) => readsResourcesImports(source.path, source.text).map((target) => `${source.path} -> ${target}`));

    expect(violations).toEqual([]);
  });

  it('names every core file that reads resources.ts at runtime, and only those', () => {
    const reading = productionSources()
      .filter((source) => source.path.startsWith('core/'))
      .filter((source) => runtimeImports(source.text).includes('../resources'))
      .map((source) => source.path);

    expect(reading.sort()).toEqual([...READS_RESOURCES].sort());
  });

  it('treats only the package entry and the commands as entry points, and nothing in src imports the entry', () => {
    expect(isEntryPoint('index.ts')).toBe(true);
    expect(isEntryPoint('commands/launch/projects/create.ts')).toBe(true);
    expect(isEntryPoint('projects/index.ts')).toBe(false);
    expect(
      productionSources().filter((source) =>
        runtimeImports(source.text).some(
          (specifier) => posix.normalize(posix.join(posix.dirname(source.path), specifier)) === 'index',
        ),
      ),
    ).toEqual([]);
  });

  it('reports a runtime import of one of them and ignores a type-only one, so it cannot pass vacuously', () => {
    expect(readsResourcesImports('projects/probe.ts', "import { resolveInputsTraced } from '../core/resolve';")).toEqual([
      'core/resolve.ts',
    ]);
    expect(readsResourcesImports('projects/probe.ts', "import type { AnyInputs } from '../core/inputs';")).toEqual([]);
    expect(readsResourcesImports('projects/probe.ts', "import { catalog } from '../resources';")).toEqual([
      'resources.ts',
    ]);
    expect(readsResourcesImports('projects/probe.ts', "import type { FlagKey } from '../resources';")).toEqual([]);
    expect(
      readsResourcesImports('core/probe.ts', "import {\n  buildServiceContext,\n} from './service-context';"),
    ).toEqual(['core/service-context.ts']);
  });
});
