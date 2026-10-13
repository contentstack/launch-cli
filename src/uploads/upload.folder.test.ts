import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServiceContext } from '../core/service-context';
import type { ApiSurface } from '../resources';

jest.mock('./upload.transfer', () => ({
  ...jest.requireActual('./upload.transfer'),
  uploadArchive: jest.fn(async () => undefined),
}));

import { FolderUploader } from './upload.folder';
import { uploadArchive } from './upload.transfer';

const SIGNED = { uploadUrl: 'https://uploads.example.test/x', uploadUid: 'upload-uid' };

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'launch-upload-folder-'));
  writeFileSync(join(folder, 'index.html'), `<h1>site</h1><!-- ${randomBytes(2048).toString('hex')} -->`);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function uploader() {
  const asked: unknown[] = [];
  const api = {
    uploads: {
      signedUploadUrl: async (scope: unknown) => {
        asked.push(scope);
        return SIGNED;
      },
    },
  } as unknown as ApiSurface;
  const services: ServiceContext = {
    api,
    ux: { print: () => undefined, inquire: async () => undefined as never },
    isTTY: false,
    outputIsTTY: false,
  };

  return { uploader: new FolderUploader(services), asked };
}

describe('FolderUploader', () => {
  it.each([
    [{ org: 'org1' }],
    [{ org: 'org1', project: 'p1' }],
    [{ org: 'org1', project: 'p1', environment: 'e1' }],
  ])('asks for the upload url in the scope %j and hands back its upload uid', async (scope) => {
    const { uploader: folderUploader, asked } = uploader();

    const uploadUid = await folderUploader.upload(scope, folder);

    expect(asked).toEqual([scope]);
    expect(uploadUid).toBe('upload-uid');
    expect(uploadArchive).toHaveBeenCalledWith(SIGNED, expect.any(Buffer), expect.anything());
  });
});
