import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getByPath, readProjectConfig } from './project-config';

const tempDirs: string[] = [];

function writeConfig(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'launch-cfg-'));
  tempDirs.push(dir);
  const path = join(dir, '.cs-launch.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

afterEach(() => {
  tempDirs.forEach(dir => {
    rmSync(dir, { recursive: true, force: true });
  });
  tempDirs.length = 0;
});

describe('readProjectConfig', () => {
  it('returns the sole config block', () => {
    const path = writeConfig({ project: { uid: 'p1', organizationUid: 'org1' } });

    expect(readProjectConfig(path)).toEqual({ uid: 'p1', organizationUid: 'org1' });
  });

  it('returns an empty object when the file does not exist', () => {
    expect(readProjectConfig('/nope/.cs-launch.json')).toEqual({});
  });

  it('returns an empty object when the file is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-cfg-'));
    tempDirs.push(dir);
    const path = join(dir, '.cs-launch.json');
    writeFileSync(path, 'not json');

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when several blocks exist, deferring branch selection', () => {
    const path = writeConfig({ main: { uid: 'p1' }, staging: { uid: 'p2' } });

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the file contains null', () => {
    const path = writeConfig(null);

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the file contains a non-object primitive', () => {
    const path = writeConfig(42);

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the file contains a string primitive', () => {
    const path = writeConfig('string');

    expect(readProjectConfig(path)).toEqual({});
  });
});

describe('getByPath', () => {
  it('reads a nested value and returns undefined for a missing one', () => {
    const source = { a: { b: 'value' } };

    expect(getByPath(source, 'a.b')).toBe('value');
    expect(getByPath(source, 'a.c')).toBeUndefined();
    expect(getByPath(undefined, 'a')).toBeUndefined();
  });

  it('returns undefined when traversing through a null intermediate', () => {
    expect(getByPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('returns undefined when a path segment hits a primitive', () => {
    expect(getByPath({ a: 5 }, 'a.b')).toBeUndefined();
  });

  it('returns undefined when the path is an empty string', () => {
    expect(getByPath({ a: 'value' }, '')).toBeUndefined();
  });
});
