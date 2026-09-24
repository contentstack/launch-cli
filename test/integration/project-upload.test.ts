import nock from 'nock';

import { UploadFailedError } from '../../src/projects/project.errors';
import { uploadArchive } from '../../src/projects/project.upload';

const HOST = 'https://uploads.integration.test';
const ARCHIVE = Buffer.from('archive-bytes');

describe('integration: uploading the project archive on the wire', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('puts the archive as the raw body when the signed url carries no fields', async () => {
    let seen = '';
    const scope = nock(HOST)
      .put('/bucket/project.zip')
      .matchHeader('content-type', 'application/zip')
      .matchHeader('content-length', String(ARCHIVE.length))
      .matchHeader('x-ms-blob-type', 'BlockBlob')
      .reply(201, function (_uri: string, body: unknown) {
        seen = String(body);
        return '';
      });

    await uploadArchive(
      {
        uploadUrl: `${HOST}/bucket/project.zip`,
        uploadUid: 'upload-uid',
        headers: [{ key: 'x-ms-blob-type', value: 'BlockBlob' }],
      },
      ARCHIVE,
    );

    expect(scope.isDone()).toBe(true);
    expect(seen).toBe('archive-bytes');
  });

  it('posts a multipart body carrying the fields and the archive when the signed url carries fields', async () => {
    let seen = '';
    const scope = nock(HOST)
      .post('/bucket')
      .reply(204, function (_uri: string, body: unknown) {
        seen = String(body);
        return '';
      });

    await uploadArchive(
      {
        uploadUrl: `${HOST}/bucket`,
        uploadUid: 'upload-uid',
        fields: [{ formFieldKey: 'key', formFieldValue: 'uploads/project.zip' }],
      },
      ARCHIVE,
    );

    expect(scope.isDone()).toBe(true);
    expect(seen).toContain('name="key"');
    expect(seen).toContain('uploads/project.zip');
    expect(seen).toContain('filename="project.zip"');
    expect(seen).toContain('archive-bytes');
  });

  it('follows the signed url onto plain http when that is what it names', async () => {
    const scope = nock('http://uploads.integration.test').put('/bucket').reply(200);

    await uploadArchive({ uploadUrl: 'http://uploads.integration.test/bucket', uploadUid: 'u' }, ARCHIVE);

    expect(scope.isDone()).toBe(true);
  });

  it('exits 1 naming the status when the upload is refused midway', async () => {
    nock(HOST).put('/bucket').reply(403, '<Error>AccessDenied</Error>');

    const failure = await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, ARCHIVE).catch(
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(UploadFailedError);
    expect((failure as UploadFailedError).exitCode).toBe(1);
    expect((failure as Error).message).toBe('The upload of your project files was refused with HTTP 403.');
  });

  it('accepts 299, the last status in the success range', async () => {
    const scope = nock(HOST).put('/bucket').reply(299, '');

    await expect(uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, ARCHIVE)).resolves.toBeUndefined();

    expect(scope.isDone()).toBe(true);
  });

  it.each([[300], [302], [303], [304]])('exits 1 rather than reporting a redirect (%p) as an upload', async (status) => {
    nock(HOST).put('/bucket').reply(status, '', { location: `${HOST}/elsewhere` });

    const failure = await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, ARCHIVE).catch(
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(UploadFailedError);
    expect((failure as UploadFailedError).exitCode).toBe(1);
    expect((failure as Error).message).toBe(`The upload of your project files was refused with HTTP ${status}.`);
  });

  it('sends the zip content type on the wire when the signed url supplied a blank one', async () => {
    const scope = nock(HOST).put('/bucket').matchHeader('content-type', 'application/zip').reply(200, '');

    const blankContentType = {
      key: 'Content-Type',
      value: '',
    };

    await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u', headers: [blankContentType] }, ARCHIVE);

    expect(scope.isDone()).toBe(true);
  });

  it('exits 1 naming the transport failure when the socket dies midway', async () => {
    nock(HOST).put('/bucket').replyWithError(new Error('socket hang up'));

    const failure = await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, ARCHIVE).catch(
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(UploadFailedError);
    expect((failure as Error).message).toBe('The upload of your project files failed: socket hang up');
  });
});
