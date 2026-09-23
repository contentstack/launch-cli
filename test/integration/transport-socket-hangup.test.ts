import { randomUUID } from 'node:crypto';
import { AddressInfo, Socket } from 'node:net';
import { Server, createServer } from 'node:http';

import { LaunchNetworkError } from '../../src/transport/errors';
import { HttpMethod, RestApiClient } from '../../src/transport/rest-client';

const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0-alpha.0 darwin-arm64 node-v22.0.0';
const ORG_UID = 'blt4d9e2a7c1f6b3085';

interface WireServer {
  baseUrl: string;
  wire: { method: string; url: string }[];
  close: () => Promise<void>;
}

async function hangUpServer(): Promise<WireServer> {
  const wire: { method: string; url: string }[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((request, response) => {
    wire.push({ method: request.method ?? '', url: request.url ?? '' });
    response.socket?.destroy();
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/manage`,
    wire,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

function buildClient(baseUrl: string, maxRetries: number): RestApiClient {
  return new RestApiClient({
    baseUrl,
    analyticsInfo: ANALYTICS_INFO,
    auth: { headers: async () => ({ authtoken: randomUUID() }) },
    maxRetries,
    retryDelayMs: 0,
    sleep: async () => undefined,
  });
}

describe('integration: a real socket hang up over the wire', () => {
  let server: WireServer;

  beforeEach(async () => {
    server = await hangUpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[])(
    'puts exactly one %s on the wire when the server hangs up mid-request',
    async (method) => {
      const rejection = await buildClient(server.baseUrl, 3)
        .request({ method, path: '/projects', body: { name: 'site' }, orgUid: ORG_UID })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(LaunchNetworkError);
      expect((rejection as LaunchNetworkError).message).toBe(
        'Could not reach the Launch API (ECONNRESET). Check your network connection and try again.',
      );
      expect(server.wire).toEqual([{ method, url: '/manage/projects' }]);
    },
  );

  it.each(['GET', 'HEAD'] as HttpMethod[])(
    'puts one %s plus the retry budget on the wire when the server hangs up mid-request',
    async (method) => {
      const rejection = await buildClient(server.baseUrl, 2)
        .request({ method, path: '/projects', orgUid: ORG_UID })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(LaunchNetworkError);
      expect(server.wire).toEqual([
        { method, url: '/manage/projects' },
        { method, url: '/manage/projects' },
        { method, url: '/manage/projects' },
      ]);
    },
  );
});
