import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const LAYERS = ['core', 'transport'];
const RESOURCES = ['projects', 'functions', 'environments', 'deployments', 'git'];

function sourceFilesIn(layer: string): string[] {
  return readdirSync(join(SRC, layer))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => join(layer, entry));
}

function importedPaths(relativePath: string): string[] {
  const contents = readFileSync(join(SRC, relativePath), 'utf8');
  return [...contents.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
}

function resourceImports(relativePath: string): string[] {
  return importedPaths(relativePath).filter((specifier) =>
    RESOURCES.some((resource) => specifier.startsWith(`../${resource}/`) || specifier === `../${resource}`),
  );
}

describe('layering', () => {
  it.each(LAYERS.flatMap((layer) => sourceFilesIn(layer)))('%s imports no resource directly', (relativePath) => {
    expect(resourceImports(relativePath)).toEqual([]);
  });

  it('finds the layer sources it claims to be checking', () => {
    expect(sourceFilesIn('core').length).toBeGreaterThan(0);
    expect(sourceFilesIn('transport').length).toBeGreaterThan(0);
  });

  it('reports a resource import when one is present, so the check cannot pass vacuously', () => {
    const contrived = importedPaths(join('projects', 'project.inputs.ts'));

    expect(contrived).toContain('../core/resolution');
    expect(
      contrived.filter((specifier) => RESOURCES.some((resource) => specifier.startsWith(`../${resource}/`))),
    ).toEqual([]);
    expect(
      ['../projects/types', './types'].filter((specifier) =>
        RESOURCES.some((resource) => specifier.startsWith(`../${resource}/`)),
      ),
    ).toEqual(['../projects/types']);
  });
});
