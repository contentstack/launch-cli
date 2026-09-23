import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UsageError } from './errors';
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

  it('uses the shared block when several branch blocks name the same project', () => {
    const path = writeConfig({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p1', organizationUid: 'org1' },
    });

    expect(readProjectConfig(path)).toEqual({ uid: 'p1', organizationUid: 'org1' });
  });

  it('uses the shared block for a realistic two-branch v1 config file', () => {
    const path = writeConfig({
      main: {
        uid: 'blt1111111111111111',
        organizationUid: 'blt2222222222222222',
        name: 'my-site',
        environments: [{ uid: 'blt3333333333333333', name: 'Default' }],
      },
      'feature/checkout': {
        uid: 'blt1111111111111111',
        organizationUid: 'blt2222222222222222',
        name: 'my-site',
        environments: [{ uid: 'blt4444444444444444', name: 'Preview' }],
      },
    });

    expect(getByPath(readProjectConfig(path), 'uid')).toBe('blt1111111111111111');
    expect(getByPath(readProjectConfig(path), 'organizationUid')).toBe('blt2222222222222222');
  });

  it('raises a usage error when the branch blocks name different projects', () => {
    const path = writeConfig({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p2', organizationUid: 'org1' },
    });

    expect(() => readProjectConfig(path)).toThrow(UsageError);
    expect(() => readProjectConfig(path)).toThrow('--org');
    expect(() => readProjectConfig(path)).toThrow('--project');
    expect(() => readProjectConfig(path)).toThrow('main, staging');
  });

  it('raises a usage error when the branch blocks name different organizations', () => {
    const path = writeConfig({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p1', organizationUid: 'org2' },
    });

    expect(() => readProjectConfig(path)).toThrow(UsageError);
    expect(() => readProjectConfig(path)).toThrow('main, staging');
  });

  it('raises a usage error when a branch block is not an object', () => {
    const path = writeConfig({ main: { uid: 'p1', organizationUid: 'org1' }, staging: 'p1' });

    expect(() => readProjectConfig(path)).toThrow(UsageError);
    expect(() => readProjectConfig(path)).toThrow('main, staging');
  });

  it('raises a usage error when a branch block is null', () => {
    const path = writeConfig({ main: { uid: 'p1', organizationUid: 'org1' }, staging: null });

    expect(() => readProjectConfig(path)).toThrow(UsageError);
  });

  it('raises a usage error when every branch block is a primitive', () => {
    const path = writeConfig({ main: 'p1', staging: 'p1' });

    expect(() => readProjectConfig(path)).toThrow(UsageError);
    expect(() => readProjectConfig(path)).toThrow('main, staging');
  });

  it('returns an empty object when the sole block holds a primitive instead of a project', () => {
    const path = writeConfig({ main: 'x' });

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the sole block is an array', () => {
    const path = writeConfig({ main: [{ uid: 'p1', organizationUid: 'org1' }] });

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the sole block is null', () => {
    const path = writeConfig({ main: null });

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the file root is an array', () => {
    const path = writeConfig([{ uid: 'p1', organizationUid: 'org1' }]);

    expect(readProjectConfig(path)).toEqual({});
  });

  it('returns an empty object when the file root is an empty array', () => {
    const path = writeConfig([]);

    expect(readProjectConfig(path)).toEqual({});
  });

  it('raises a usage error when every branch block is an array', () => {
    const path = writeConfig({ main: [{ uid: 'p1' }], staging: [{ uid: 'p1' }] });

    expect(() => readProjectConfig(path)).toThrow(UsageError);
    expect(() => readProjectConfig(path)).toThrow('main, staging');
  });

  it('returns an empty object when the file holds no blocks at all', () => {
    const path = writeConfig({});

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
