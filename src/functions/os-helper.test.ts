import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { checkIfDirectoryExists, walkFileSystem } from './os-helper';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'launch-os-helper-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function collect(directory: string): Promise<string[]> {
  const found: string[] = [];
  for await (const filePath of walkFileSystem(directory)) {
    found.push(filePath);
  }
  return found.sort();
}

describe('checkIfDirectoryExists', () => {
  it('reports true for a directory that exists', () => {
    expect(checkIfDirectoryExists(workspace)).toBe(true);
  });

  it('reports false for a path that does not exist', () => {
    expect(checkIfDirectoryExists(join(workspace, 'absent'))).toBe(false);
  });
});

describe('walkFileSystem', () => {
  it('yields nothing for an empty directory', async () => {
    expect(await collect(workspace)).toEqual([]);
  });

  it('yields every file and recurses into nested directories', async () => {
    mkdirSync(join(workspace, 'api', 'nested'), { recursive: true });
    writeFileSync(join(workspace, 'top.js'), '');
    writeFileSync(join(workspace, 'api', 'mid.js'), '');
    writeFileSync(join(workspace, 'api', 'nested', 'deep.txt'), '');

    expect(await collect(workspace)).toEqual(
      [join(workspace, 'api', 'mid.js'), join(workspace, 'api', 'nested', 'deep.txt'), join(workspace, 'top.js')].sort(),
    );
  });

  it('yields nothing for a directory whose only entries are empty directories', async () => {
    mkdirSync(join(workspace, 'a', 'b'), { recursive: true });

    expect(await collect(workspace)).toEqual([]);
  });

  it('rejects when the directory does not exist', async () => {
    await expect(collect(join(workspace, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
