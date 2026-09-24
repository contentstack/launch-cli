import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, resolve as resolvePath } from 'node:path';

import * as ts from 'typescript';

const projectRoot = resolvePath(__dirname, '..', '..');
const sourceRoot = join(projectRoot, 'src');

interface PackageJson {
  dependencies?: Record<string, string>;
  oclif?: { plugins?: string[] };
}

function readPackage(): PackageJson {
  return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as PackageJson;
}

function compilerOptions(): ts.CompilerOptions {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const tsconfig = ts.parseConfigFileTextToJson(tsconfigPath, readFileSync(tsconfigPath, 'utf8'));

  return ts.convertCompilerOptionsFromJson(tsconfig.config.compilerOptions, projectRoot).options;
}

function runtimeSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return runtimeSources(path);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function packageOf(specifier: string): string {
  const parts = specifier.split('/');

  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(packageOf(specifier));
}

function requiredPackages(): Map<string, string[]> {
  const options = compilerOptions();
  const found = new Map<string, string[]>();

  for (const path of runtimeSources(sourceRoot)) {
    const emitted = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: options, fileName: path });

    for (const match of emitted.outputText.matchAll(/require\("([^"]+)"\)/g)) {
      const specifier = match[1];

      if (specifier.startsWith('.') || isBuiltin(specifier)) {
        continue;
      }

      const name = packageOf(specifier);
      found.set(name, [...(found.get(name) ?? []), relative(projectRoot, path)]);
    }
  }

  return found;
}

describe('package dependencies', () => {
  it('declares every package the compiled runtime code requires as a production dependency', () => {
    const declared = Object.keys(readPackage().dependencies ?? {});

    const required = requiredPackages();
    const undeclared = [...required.entries()]
      .filter(([name]) => !declared.includes(name))
      .map(([name, files]) => `${name} (required by ${files.join(', ')})`);

    expect(required.has('tslib')).toBe(true);
    expect(required.has('@oclif/core')).toBe(true);
    expect(undeclared).toEqual([]);
  });

  it('declares every oclif plugin as a production dependency', () => {
    const pkg = readPackage();
    const declared = Object.keys(pkg.dependencies ?? {});

    const plugins = pkg.oclif?.plugins ?? [];
    const undeclared = plugins.filter((plugin) => !declared.includes(plugin));

    expect(plugins).toContain('@oclif/plugin-help');
    expect(undeclared).toEqual([]);
  });
});
