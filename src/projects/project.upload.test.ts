import { UsageError } from '../core/errors';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CONTENT_TYPE,
  UPLOAD_FILE_NAME,
  prepareUpload,
  refuseOversizedArchive,
} from './project.upload';
import type { SignedUploadFormField, SignedUploadHeader } from './types';

function header(name: string, contents: string): SignedUploadHeader {
  return { key: name, value: contents };
}

function formField(name: string, contents: string): SignedUploadFormField {
  return { formFieldKey: name, formFieldValue: contents };
}

function contentTypeNames(headers: Record<string, string>): string[] {
  const names = Object.keys(headers);
  return names.filter((header) => header.toLowerCase() === 'content-type');
}


const ARCHIVE = Buffer.from('PK\u0003\u0004zip-bytes');
const UPLOAD_URL = 'https://uploads.example.test/bucket';
const UPLOAD_UID = 'upload-uid';

describe('signed upload preparation', () => {
  it('sends the archive as the raw body when the signed url carries no form fields', () => {
    const prepared = prepareUpload({ uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID }, ARCHIVE);

    expect(prepared.method).toBe('PUT');
    expect(prepared.body).toBe(ARCHIVE);
    expect(prepared.headers).toEqual({
      'content-type': UPLOAD_CONTENT_TYPE,
      'content-length': String(ARCHIVE.length),
    });
  });

  it('keeps the method the signed url asked for', () => {
    const prepared = prepareUpload({ uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, method: 'POST' }, ARCHIVE);

    expect(prepared.method).toBe('POST');
  });

  it('keeps a content type the signed url supplied rather than overwriting it', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        headers: [{ key: 'content-type', value: 'application/octet-stream' }],
      },
      ARCHIVE,
    );

    expect(prepared.headers['content-type']).toBe('application/octet-stream');
  });

  it.each([[''], ['   ']])('sends the zip content type when the signed url supplied a blank one (%p)', (blank) => {
    const prepared = prepareUpload(
      { uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, headers: [header('Content-Type', blank)] },
      ARCHIVE,
    );

    expect(prepared.headers).toEqual({
      'content-type': UPLOAD_CONTENT_TYPE,
      'content-length': String(ARCHIVE.length),
    });
  });

  it('keeps a content type the signed url supplied under a capitalised header name', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        headers: [header('Content-Type', 'application/octet-stream')],
      },
      ARCHIVE,
    );

    expect(prepared.headers).toEqual({
      'content-type': 'application/octet-stream',
      'content-length': String(ARCHIVE.length),
    });
  });

  it('folds every supplied header name to one canonical casing', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        headers: [header('X-Ms-Blob-Type', 'BlockBlob'), header('Content-Length', '9999')],
      },
      ARCHIVE,
    );

    expect(prepared.headers).toEqual({
      'x-ms-blob-type': 'BlockBlob',
      'content-type': UPLOAD_CONTENT_TYPE,
      'content-length': String(ARCHIVE.length),
    });
  });

  it('overrides a capitalised content type when the signed url carries form fields', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        headers: [header('Content-Type', 'application/octet-stream')],
        fields: [formField('acl', 'private')],
      },
      ARCHIVE,
    );

    expect(contentTypeNames(prepared.headers)).toEqual(['content-type']);
    expect(prepared.headers['content-type']).toContain('multipart/form-data');
  });

  it('carries every header the signed url supplied', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        headers: [{ key: 'x-ms-blob-type', value: 'BlockBlob' }],
      },
      ARCHIVE,
    );

    expect(prepared.headers['x-ms-blob-type']).toBe('BlockBlob');
  });

  it('builds a multipart body with the form fields before the file when the signed url carries fields', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        fields: [
          formField('key', 'uploads/project.zip'),
          formField('policy', 'a-policy'),
        ],
      },
      ARCHIVE,
    );
    const body = prepared.body.toString('binary');
    const boundary = prepared.headers['content-type'].split('boundary=')[1];

    expect(prepared.method).toBe('POST');
    expect(prepared.headers['content-type']).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(prepared.headers['content-length']).toBe(String(prepared.body.length));
    expect(body.indexOf('name="key"')).toBeLessThan(body.indexOf('name="policy"'));
    expect(body.indexOf('name="policy"')).toBeLessThan(body.indexOf(`filename="${UPLOAD_FILE_NAME}"`));
    expect(body).toContain('uploads/project.zip');
    expect(body).toContain(ARCHIVE.toString('binary'));
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('keeps the method the signed url asked for even when it carries form fields', () => {
    const prepared = prepareUpload(
      { uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, method: 'PUT', fields: [formField('key', 'k')] },
      ARCHIVE,
    );

    expect(prepared.method).toBe('PUT');
    expect(prepared.headers['content-type']).toContain('multipart/form-data');
  });

  it('gives each upload its own boundary rather than a fixed one', () => {
    const target = { uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, fields: [formField('key', 'k')] };

    const first = prepareUpload(target, ARCHIVE).headers['content-type'];
    const second = prepareUpload(target, ARCHIVE).headers['content-type'];

    expect(first).not.toBe(second);
  });

  it('treats a field with a missing value as an empty one and drops a field with no key', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        fields: [{ formFieldKey: 'acl' }, { formFieldValue: 'orphan' }, { formFieldKey: '', formFieldValue: 'blank' }],
        headers: [{ value: 'headerless' }],
      },
      ARCHIVE,
    );
    const body = prepared.body.toString('binary');

    expect(body).toContain('name="acl"\r\n\r\n\r\n');
    expect(body).not.toContain('orphan');
    expect(body).not.toContain('blank');
    expect(prepared.headers).not.toHaveProperty('undefined');
  });

  it('treats an empty fields array as no fields at all', () => {
    const prepared = prepareUpload({ uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, fields: [] }, ARCHIVE);

    expect(prepared.method).toBe('PUT');
    expect(prepared.body).toBe(ARCHIVE);
  });

  it('treats the null fields and headers the service may send as none at all', () => {
    const prepared = prepareUpload({ uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, fields: null, headers: null }, ARCHIVE);

    expect(prepared.method).toBe('PUT');
    expect(prepared.body).toBe(ARCHIVE);
    expect(prepared.headers).toEqual({
      'content-type': UPLOAD_CONTENT_TYPE,
      'content-length': String(ARCHIVE.length),
    });
  });

  it('reads a form field by formFieldKey and formFieldValue as the signed-url contract names them', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        method: 'POST',
        fields: [formField('X-Amz-Signature', 'signed-value')],
      },
      ARCHIVE,
    );
    const body = prepared.body.toString('binary');

    expect(prepared.method).toBe('POST');
    expect(body).toContain('Content-Disposition: form-data; name="X-Amz-Signature"\r\n\r\nsigned-value\r\n');
  });
});

describe('refuseOversizedArchive', () => {
  it('caps an upload at the 100 MB Launch accepts for a file upload', () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });

  it('lets an archive of exactly the limit through', () => {
    expect(() => refuseOversizedArchive(MAX_UPLOAD_BYTES)).not.toThrow();
  });

  it('refuses an archive one byte over the limit as a usage error', () => {
    expect(() => refuseOversizedArchive(MAX_UPLOAD_BYTES + 1)).toThrow(UsageError);
  });

  it('names the archive size, the limit, and how to shrink the upload', () => {
    expect(() => refuseOversizedArchive(150 * 1024 * 1024)).toThrow(
      'Your project files zip to 150.0 MB, over the 100 MB Launch accepts for a file upload. ' +
        'Pass --data-dir with a folder holding only the files to deploy.',
    );
  });
});
