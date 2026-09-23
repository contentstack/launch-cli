import { UPLOAD_CONTENT_TYPE, UPLOAD_FILE_NAME, prepareUpload } from './project.upload';

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
          { key: 'key', value: 'uploads/project.zip' },
          { key: 'policy', value: 'a-policy' },
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
      { uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, method: 'PUT', fields: [{ key: 'key', value: 'k' }] },
      ARCHIVE,
    );

    expect(prepared.method).toBe('PUT');
    expect(prepared.headers['content-type']).toContain('multipart/form-data');
  });

  it('gives each upload its own boundary rather than a fixed one', () => {
    const target = { uploadUrl: UPLOAD_URL, uploadUid: UPLOAD_UID, fields: [{ key: 'key', value: 'k' }] };

    const first = prepareUpload(target, ARCHIVE).headers['content-type'];
    const second = prepareUpload(target, ARCHIVE).headers['content-type'];

    expect(first).not.toBe(second);
  });

  it('treats a field with a missing value as an empty one and drops a field with no key', () => {
    const prepared = prepareUpload(
      {
        uploadUrl: UPLOAD_URL,
        uploadUid: UPLOAD_UID,
        fields: [{ key: 'acl' }, { value: 'orphan' }, { key: '', value: 'blank' }],
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
});
