import type { IncomingHttpHeaders, Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';

import { randomBytes } from 'node:crypto';

import { UploadFailedError } from '../../src/projects/project.errors';
import { uploadArchive } from '../../src/projects/project.upload';
import type { SignedUploadUrl } from '../../src/projects/types';

const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy'];
const ARCHIVE = Buffer.from('archive-bytes');

interface Received {
  method?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

async function listening(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function closing(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

function storageServer(received: Received[]): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(201).end();
    });
  });
}

function tunnellingProxy(connects: string[]): Server {
  const server = createServer();
  server.on('connect', (req, client) => {
    connects.push(req.url as string);
    const [host, port] = (req.url as string).split(':');
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });
  return server;
}

async function uploadThroughProxy(
  target: (storageUrl: string) => SignedUploadUrl,
): Promise<{ connects: string[]; received: Received[]; storagePort: number }> {
  const received: Received[] = [];
  const connects: string[] = [];
  const storage = storageServer(received);
  const proxy = tunnellingProxy(connects);
  const storagePort = await listening(storage);
  process.env.HTTPS_PROXY = `http://127.0.0.1:${await listening(proxy)}`;

  try {
    await uploadArchive(target(`http://127.0.0.1:${storagePort}`), ARCHIVE);
  } finally {
    await Promise.all([closing(proxy), closing(storage)]);
  }

  return { connects, received, storagePort };
}

describe('integration: uploading the project archive through a proxy', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of PROXY_VARIABLES) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PROXY_VARIABLES) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('tunnels the upload through HTTPS_PROXY with the signed headers and body unchanged', async () => {
    const { connects, received, storagePort } = await uploadThroughProxy((storage) => ({
      uploadUrl: `${storage}/bucket/project.zip`,
      uploadUid: 'upload-uid',
      headers: [{ key: 'x-ms-blob-type', value: 'BlockBlob' }],
    }));

    expect(connects).toEqual([`127.0.0.1:${storagePort}`]);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      method: 'PUT',
      body: 'archive-bytes',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': 'application/zip', 'content-length': '13' },
    });
  });

  it('tunnels the multipart POST of a form-field signed url, as AWS issues, through the proxy', async () => {
    const { connects, received, storagePort } = await uploadThroughProxy((storage) => ({
      uploadUrl: `${storage}/bucket`,
      uploadUid: 'upload-uid',
      fields: [{ formFieldKey: 'key', formFieldValue: 'uploads/project.zip' }],
    }));

    expect(connects).toEqual([`127.0.0.1:${storagePort}`]);
    expect(received[0].method).toBe('POST');
    expect(received[0].body).toContain('uploads/project.zip');
    expect(received[0].body).toContain('archive-bytes');
  });

  it('names the proxy, never its credentials, when the proxy cannot be reached', async () => {
    const user = `u${randomBytes(4).toString('hex')}`;
    const phrase = randomBytes(12).toString('hex');
    const closed = createServer();
    const port = await listening(closed);
    await closing(closed);
    process.env.HTTPS_PROXY = `http://${user}:${phrase}@127.0.0.1:${port}`;

    const failure = await uploadArchive({ uploadUrl: 'https://storage.example.test/bucket', uploadUid: 'u' }, ARCHIVE).catch(
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(UploadFailedError);
    expect((failure as Error).message).toBe(
      `Proxy error: Unable to connect to proxy server at http://127.0.0.1:${port}. Please verify your proxy configuration.`,
    );
  });
});
