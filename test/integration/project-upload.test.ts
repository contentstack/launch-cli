import nock from 'nock';

import { UploadFailedError } from '../../src/uploads/upload.errors';
import { UPLOAD_CHUNK_BYTES, UPLOAD_IDLE_TIMEOUT_MS, uploadArchive } from '../../src/uploads/upload.transfer';

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

  it('gives up with exit 1 when the upload stalls, rather than hanging the command', async () => {
    nock(HOST).put('/bucket').delayConnection(2000).reply(201);

    const failure = await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, ARCHIVE, {
      idleTimeoutMs: 50,
    }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UploadFailedError);
    expect((failure as Error).message).toBe(
      'The upload of your project files stalled: nothing was sent or received for 0.05 seconds.',
    );
  });

  it('waits up to two minutes of silence by default, a limit on idleness rather than on the size of the upload', () => {
    expect(UPLOAD_IDLE_TIMEOUT_MS).toBe(120_000);
  });

  it('sends the body in chunks of a quarter megabyte by default', () => {
    expect(UPLOAD_CHUNK_BYTES).toBe(256 * 1024);
  });

  it('reports every chunk it flushed, rising to the whole body, and delivers the body intact', async () => {
    const body = Buffer.from('0123456789');
    let seen = '';
    const scope = nock(HOST)
      .put('/bucket')
      .reply(200, function (_uri: string, received: unknown) {
        seen = String(received);
        return '';
      });
    const reported: [number, number][] = [];

    await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, body, {
      chunkBytes: 4,
      onProgress: (sent, total) => reported.push([sent, total]),
    });

    expect(scope.isDone()).toBe(true);
    expect(seen).toBe('0123456789');
    expect(reported).toEqual([
      [0, 10],
      [4, 10],
      [8, 10],
      [10, 10],
    ]);
  });

  it('reports the multipart envelope, not just the archive, because that is what is on the wire', async () => {
    nock(HOST).post('/bucket').reply(204, '');
    const reported: number[] = [];

    await uploadArchive(
      {
        uploadUrl: `${HOST}/bucket`,
        uploadUid: 'u',
        fields: [{ formFieldKey: 'key', formFieldValue: 'uploads/project.zip' }],
      },
      ARCHIVE,
      { onProgress: (sent) => reported.push(sent) },
    );

    expect(reported).toEqual([0, expect.any(Number)]);
    expect(reported[1]).toBeGreaterThan(ARCHIVE.length);
  });

  it('reports the wire total before the first byte, so a bar can size itself against it', async () => {
    nock(HOST)
      .post('/bucket')
      .reply(204, '');
    const reported: [number, number][] = [];

    await uploadArchive(
      {
        uploadUrl: `${HOST}/bucket`,
        uploadUid: 'u',
        fields: [{ formFieldKey: 'key', formFieldValue: 'uploads/project.zip' }],
      },
      ARCHIVE,
      { onProgress: (sent, total) => reported.push([sent, total]) },
    );

    const [[firstSent, wireTotal]] = reported;

    expect(firstSent).toBe(0);
    expect(wireTotal).toBeGreaterThan(ARCHIVE.length);
    for (const [sent, total] of reported) {
      expect(total).toBe(wireTotal);
      expect(sent).toBeLessThanOrEqual(wireTotal);
    }
    expect(reported[reported.length - 1][0]).toBe(wireTotal);
  });

  it('reports one flush for a body smaller than a chunk, and none for an empty one', async () => {
    nock(HOST).put('/bucket').reply(200, '');
    const small: number[] = [];

    await uploadArchive({ uploadUrl: `${HOST}/bucket`, uploadUid: 'u' }, ARCHIVE, {
      onProgress: (sent) => small.push(sent),
    });

    nock(HOST).put('/empty').reply(200, '');
    const empty: number[] = [];

    await uploadArchive({ uploadUrl: `${HOST}/empty`, uploadUid: 'u' }, Buffer.alloc(0), {
      onProgress: (sent) => empty.push(sent),
    });

    expect(small).toEqual([0, ARCHIVE.length]);
    expect(empty).toEqual([0]);
  });
});
