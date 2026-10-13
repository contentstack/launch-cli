import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import * as ts from 'typescript';

const projectRoot = resolvePath(__dirname, '..', '..');
const sourcePath = join(projectRoot, 'src', 'functions', 'load-data-url.ts');
const tempDirs: string[] = [];

function compileLoader(): string {
  const tsconfigText = readFileSync(join(projectRoot, 'tsconfig.json'), 'utf8');
  const tsconfig = ts.parseConfigFileTextToJson(join(projectRoot, 'tsconfig.json'), tsconfigText);
  const { options } = ts.convertCompilerOptionsFromJson(tsconfig.config.compilerOptions, projectRoot);
  const emitted = ts.transpileModule(readFileSync(sourcePath, 'utf8'), { compilerOptions: options });

  const dir = mkdtempSync(join(projectRoot, '.compiled-loader-'));
  tempDirs.push(dir);
  const outputPath = join(dir, 'load-data-url.js');
  writeFileSync(outputPath, emitted.outputText);

  return outputPath;
}

function runLoaderInNode(loaderPath: string): string {
  const script = [
    `const { loadDataURL } = require(${JSON.stringify(loaderPath)});`,
    `const url = 'data:text/javascript;base64,' + Buffer.from('export const x = 1;').toString('base64');`,
    `loadDataURL(url).then((m) => console.log('LOADED:' + m.x)).catch((e) => console.log('FAILED:' + e.code));`,
  ].join('\n');

  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim();
}

afterEach(() => {
  tempDirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
  tempDirs.length = 0;
});

describe('compiled loadDataURL', () => {
  it('imports a data url module when the commonjs build output runs under node', () => {
    expect(runLoaderInNode(compileLoader())).toBe('LOADED:1');
  });

  it('keeps the dynamic import out of the commonjs downlevel', () => {
    expect(readFileSync(compileLoader(), 'utf8')).not.toContain('require(s)');
  });
});
