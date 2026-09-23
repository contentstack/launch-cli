import AdmZip from 'adm-zip';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UsageError } from '../core/errors';
import { UPLOAD_EXCLUDED_NAMES, archiveDirectory, isExcludedName } from './project.archive';

let root: string;

function file(relative: string, contents = 'x'): void {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}

function namesIn(buffer: Buffer): string[] {
  return new AdmZip(buffer)
    .getEntries()
    .map((entry) => entry.entryName)
    .sort();
}

describe('project archive', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'launch-archive-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('zips the files in the directory, keeping their relative paths', () => {
    file('index.html', '<h1>site</h1>');
    file('src/app.js', 'console.log(1);');

    const archived = archiveDirectory(root);

    expect(archived.entries).toEqual(['index.html', 'src/app.js']);
    expect(namesIn(archived.buffer)).toEqual(['index.html', 'src/app.js']);
    expect(new AdmZip(archived.buffer).readAsText('index.html')).toBe('<h1>site</h1>');
  });

  it('excludes every named path at the top level', () => {
    file('index.html');
    for (const excluded of UPLOAD_EXCLUDED_NAMES) {
      file(`${excluded}/nested.txt`);
    }

    const archived = archiveDirectory(root);

    expect(archived.entries).toEqual(['index.html']);
  });

  it('excludes a named path nested deep in the tree, not only at the root', () => {
    file('index.html');
    file('packages/site/node_modules/left-pad/index.js');
    file('packages/site/.env');
    file('packages/site/src/main.ts');

    const archived = archiveDirectory(root);

    expect(archived.entries).toEqual(['index.html', 'packages/site/src/main.ts']);
  });

  it('applies the exclusions across a large tree rather than only a small one', () => {
    for (let index = 0; index < 250; index += 1) {
      file(`pages/page-${index}.html`);
      file(`node_modules/pkg-${index}/index.js`);
      file(`logs/run-${index}.log`);
    }

    const archived = archiveDirectory(root);

    expect(archived.entries).toHaveLength(250);
    expect(archived.entries.every((entry) => entry.startsWith('pages/'))).toBe(true);
    expect(namesIn(archived.buffer)).toHaveLength(250);
  });

  it('skips a symbolic link rather than following it into a loop', () => {
    file('index.html');
    symlinkSync(root, join(root, 'self'));

    const archived = archiveDirectory(root);

    expect(archived.entries).toEqual(['index.html']);
  });

  it('refuses a path that is not a directory with a usage error naming --data-dir', () => {
    file('index.html');

    expect(() => archiveDirectory(join(root, 'index.html'))).toThrow(UsageError);
    expect(() => archiveDirectory(join(root, 'index.html'))).toThrow('--data-dir');
  });

  it('refuses a path that does not exist with a usage error naming it and --data-dir', () => {
    const missing = join(root, 'no-such-folder');

    expect(() => archiveDirectory(missing)).toThrow(UsageError);
    expect(() => archiveDirectory(missing)).toThrow(
      `No local project directory at "${missing}". Pass --data-dir with the folder you want to upload.`,
    );
  });

  it('refuses an empty directory rather than uploading an empty archive', () => {
    expect(() => archiveDirectory(root)).toThrow(UsageError);
    expect(() => archiveDirectory(root)).toThrow('Nothing to upload');
  });

  it('refuses a directory that holds nothing but excluded paths', () => {
    file('node_modules/left-pad/index.js');
    file('.git/HEAD');
    file('.cs-launch.json', '{}');

    expect(() => archiveDirectory(root)).toThrow(
      `Nothing to upload from "${root}" once ${UPLOAD_EXCLUDED_NAMES.join(', ')} are excluded. ` +
        'Pass --data-dir with the folder you want to upload.',
    );
  });

  it('names every path the story requires it to exclude', () => {
    expect(UPLOAD_EXCLUDED_NAMES).toEqual([
      'node_modules',
      '.git',
      '.env',
      '.env.local',
      '.next',
      'logs',
      '.vscode',
      '.cs-launch.json',
    ]);
    expect(isExcludedName('node_modules')).toBe(true);
    expect(isExcludedName('src')).toBe(false);
  });
});
