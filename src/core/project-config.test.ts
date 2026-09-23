import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UsageError } from './errors';
import { DEFAULT_BLOCK_KEY, ProjectConfigStore } from './project-config';

const tempDirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launch-cfg-'));
  tempDirs.push(dir);
  return join(dir, '.cs-launch.json');
}

function storeFor(contents: unknown): ProjectConfigStore {
  const path = tempPath();
  writeFileSync(path, JSON.stringify(contents));
  return new ProjectConfigStore(path);
}

function fileAt(store: ProjectConfigStore): unknown {
  return JSON.parse(readFileSync(store.path, 'utf8'));
}

afterEach(() => {
  tempDirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
  tempDirs.length = 0;
});

describe('ProjectConfigStore.load from a path the user named', () => {
  it('refuses a path that does not exist rather than behaving as if the file were empty', () => {
    const path = join(tempPath(), 'missing.json');
    const store = new ProjectConfigStore(path, true);

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow(`No config file found at '${path}'.`);
  });

  it('refuses a directory rather than swallowing the read failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-cfg-dir-'));
    tempDirs.push(dir);
    const store = new ProjectConfigStore(dir, true);

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow(`Could not read the config file at '${dir}'.`);
  });

  it('refuses a file that is not valid JSON', () => {
    const path = tempPath();
    writeFileSync(path, '{ not json');
    const store = new ProjectConfigStore(path, true);

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow(`The config file at '${path}' is not valid JSON.`);
  });

  it.each([['[]'], ['"text"'], ['7'], ['null']])('refuses the JSON %s because it holds no config blocks', (contents) => {
    const path = tempPath();
    writeFileSync(path, contents);
    const store = new ProjectConfigStore(path, true);

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow(`The config file at '${path}' does not hold a project config.`);
  });

  it('loads a usable file exactly as the implicit path would', () => {
    const path = tempPath();
    writeFileSync(path, JSON.stringify({ project: { uid: 'p1', organizationUid: 'org1' } }));

    expect(new ProjectConfigStore(path, true).load()).toEqual({ uid: 'p1', organizationUid: 'org1' });
  });

  it.each([[false], [undefined]])('stays silent about an unusable file when required is %p', (required) => {
    const path = join(tempPath(), 'missing.json');

    expect(new ProjectConfigStore(path, required).load()).toEqual({});
  });
});

describe('ProjectConfigStore.load', () => {
  it('returns the sole config block', () => {
    expect(storeFor({ project: { uid: 'p1', organizationUid: 'org1' } }).load()).toEqual({
      uid: 'p1',
      organizationUid: 'org1',
    });
  });

  it('returns an empty object when the file does not exist', () => {
    expect(new ProjectConfigStore('/nope/.cs-launch.json').load()).toEqual({});
  });

  it('returns an empty object when the file is not valid JSON', () => {
    const path = tempPath();
    writeFileSync(path, 'not json');

    expect(new ProjectConfigStore(path).load()).toEqual({});
  });

  it('uses the shared block when several branch blocks name the same project', () => {
    const store = storeFor({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p1', organizationUid: 'org1' },
    });

    expect(store.load()).toEqual({ uid: 'p1', organizationUid: 'org1' });
  });

  it('uses the shared block for a realistic two-branch v1 config file', () => {
    const store = storeFor({
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

    expect(store.load().uid).toBe('blt1111111111111111');
    expect(store.load().organizationUid).toBe('blt2222222222222222');
  });

  it('raises a usage error when the branch blocks name different projects', () => {
    const store = storeFor({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p2', organizationUid: 'org1' },
    });

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow('--org');
    expect(() => store.load()).toThrow('--project');
    expect(() => store.load()).toThrow('main, staging');
  });

  it('raises a usage error when the branch blocks name different organizations', () => {
    const store = storeFor({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p1', organizationUid: 'org2' },
    });

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow('main, staging');
  });

  it('raises a usage error when a branch block is not an object', () => {
    const store = storeFor({ main: { uid: 'p1', organizationUid: 'org1' }, staging: 'p1' });

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow('main, staging');
  });

  it('raises a usage error when a branch block is null', () => {
    expect(() => storeFor({ main: { uid: 'p1', organizationUid: 'org1' }, staging: null }).load()).toThrow(UsageError);
  });

  it('raises a usage error when every branch block is a primitive', () => {
    const store = storeFor({ main: 'p1', staging: 'p1' });

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow('main, staging');
  });

  it('returns an empty object when the sole block holds a primitive instead of a project', () => {
    expect(storeFor({ main: 'x' }).load()).toEqual({});
  });

  it('returns an empty object when the sole block is an array', () => {
    expect(storeFor({ main: [{ uid: 'p1', organizationUid: 'org1' }] }).load()).toEqual({});
  });

  it('returns an empty object when the sole block is null', () => {
    expect(storeFor({ main: null }).load()).toEqual({});
  });

  it('returns an empty object when the file root is an array', () => {
    expect(storeFor([{ uid: 'p1', organizationUid: 'org1' }]).load()).toEqual({});
  });

  it('returns an empty object when the file root is an empty array', () => {
    expect(storeFor([]).load()).toEqual({});
  });

  it('raises a usage error when every branch block is an array', () => {
    const store = storeFor({ main: [{ uid: 'p1' }], staging: [{ uid: 'p1' }] });

    expect(() => store.load()).toThrow(UsageError);
    expect(() => store.load()).toThrow('main, staging');
  });

  it('returns an empty object when the file holds no blocks at all', () => {
    expect(storeFor({}).load()).toEqual({});
  });

  it.each([[null], [42], ['string'], [true]])('returns an empty object when the file contains %p', (contents) => {
    expect(storeFor(contents).load()).toEqual({});
  });
});

describe('ProjectConfigStore.save', () => {
  it('writes a single default block when the file does not exist yet', () => {
    const store = new ProjectConfigStore(tempPath());

    store.save({ uid: 'p1', organizationUid: 'org1' });

    expect(fileAt(store)).toEqual({ [DEFAULT_BLOCK_KEY]: { uid: 'p1', organizationUid: 'org1' } });
    expect(store.load()).toEqual({ uid: 'p1', organizationUid: 'org1' });
  });

  it('writes a single default block when the existing file holds no blocks', () => {
    const store = storeFor({});

    store.save({ uid: 'p1', organizationUid: 'org1' });

    expect(fileAt(store)).toEqual({ [DEFAULT_BLOCK_KEY]: { uid: 'p1', organizationUid: 'org1' } });
  });

  it('writes a single default block when the existing file is not valid JSON', () => {
    const path = tempPath();
    writeFileSync(path, 'not json');
    const store = new ProjectConfigStore(path);

    store.save({ uid: 'p1', organizationUid: 'org1' });

    expect(fileAt(store)).toEqual({ [DEFAULT_BLOCK_KEY]: { uid: 'p1', organizationUid: 'org1' } });
  });

  it('merges into the sole existing block rather than replacing it', () => {
    const store = storeFor({ main: { uid: 'p1', organizationUid: 'org1', name: 'old-name' } });

    store.save({ name: 'new-name' });

    expect(fileAt(store)).toEqual({ main: { uid: 'p1', organizationUid: 'org1', name: 'new-name' } });
  });

  it('updates every branch block and discards none of them', () => {
    const store = storeFor({
      main: {
        uid: 'p1',
        organizationUid: 'org1',
        name: 'my-site',
        environments: [{ uid: 'e1', name: 'Default' }],
      },
      'feature/checkout': {
        uid: 'p1',
        organizationUid: 'org1',
        name: 'my-site',
        environments: [{ uid: 'e2', name: 'Preview' }],
      },
    });

    store.save({ name: 'renamed' });

    expect(fileAt(store)).toEqual({
      main: { uid: 'p1', organizationUid: 'org1', name: 'renamed', environments: [{ uid: 'e1', name: 'Default' }] },
      'feature/checkout': {
        uid: 'p1',
        organizationUid: 'org1',
        name: 'renamed',
        environments: [{ uid: 'e2', name: 'Preview' }],
      },
    });
  });

  it('refuses to write over branch blocks that do not agree on one project', () => {
    const store = storeFor({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p2', organizationUid: 'org1' },
    });

    expect(() => store.save({ name: 'renamed' })).toThrow(UsageError);
    expect(() => store.save({ name: 'renamed' })).toThrow('main, staging');
    expect(fileAt(store)).toEqual({
      main: { uid: 'p1', organizationUid: 'org1' },
      staging: { uid: 'p2', organizationUid: 'org1' },
    });
  });

  it('replaces a sole non-object block rather than spreading a primitive into it', () => {
    const store = storeFor({ main: 'x' });

    store.save({ uid: 'p1', organizationUid: 'org1' });

    expect(fileAt(store)).toEqual({ main: { uid: 'p1', organizationUid: 'org1' } });
  });

  it('writes the file so that a later load reads back exactly what was saved', () => {
    const store = new ProjectConfigStore(tempPath());
    const config = { uid: 'p1', organizationUid: 'org1', name: 'my-site', environments: [{ uid: 'e1', name: 'Default' }] };

    store.save(config);

    expect(store.load()).toEqual(config);
    expect(readFileSync(store.path, 'utf8').endsWith('\n')).toBe(true);
  });
});
