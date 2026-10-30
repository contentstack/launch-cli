import { randomBytes, randomUUID } from 'node:crypto';
import { getEventListeners } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { connect } from 'node:net';

import { API_VERSION } from '../../src/core/constants';
import { SessionExpiredError } from '../../src/core/errors';
import type { StreamFrame } from '../../src/transport/event-stream';
import { EVENT_STREAM_IDLE_TIMEOUT_MS, EventStreamClient } from '../../src/transport/event-stream';
import { LaunchApiError, LaunchNetworkError } from '../../src/transport/errors';
import type { AuthStrategy } from '../../src/transport/auth-strategy';
import { trackTimers } from '../support/timers';

const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy'];
const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0 linux-x64 node-v22.0.0';
const PATH = '/projects/p1/environments/e1/deployments/d1/logs/live';
const SCOPE = { path: PATH, orgUid: 'org1', projectUid: 'proj1' };

interface Seen {
  url: string;
  headers: IncomingHttpHeaders;
}

interface Harness {
  baseUrl: string;
  seen: Seen[];
  sockets: Set<Socket>;
  closed: () => number;
  stop: () => Promise<void>;
}

async function serve(handler: (req: IncomingMessage, res: ServerResponse, index: number) => void): Promise<Harness> {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  let closedSockets = 0;
  const server: Server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    handler(req, res, seen.length - 1);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      closedSockets += 1;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/logs`,
    seen,
    sockets,
    closed: () => closedSockets,
    stop: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function stream(res: ServerResponse, status = 200): void {
  res.writeHead(status, { 'content-type': 'text/event-stream' });
  res.flushHeaders();
}

function clientFor(baseUrl: string, auth?: Partial<AuthStrategy>, idleTimeoutMs?: number): EventStreamClient {
  return new EventStreamClient({
    baseUrl,
    analyticsInfo: ANALYTICS_INFO,
    auth: { headers: async () => ({ authtoken: 'tok' }), ...auth },
    idleTimeoutMs,
  });
}

async function collect(client: EventStreamClient, signal?: AbortSignal): Promise<StreamFrame[]> {
  const frames: StreamFrame[] = [];

  await client.open(SCOPE, (frame) => frames.push(frame), signal);

  return frames;
}

async function eventually(check: () => boolean): Promise<void> {
  for (let waited = 0; !check() && waited < 2000; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('integration: the server-sent events client on a real socket', () => {
  let harness: Harness;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const name of PROXY_VARIABLES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(async () => {
    await harness?.stop();
    for (const name of PROXY_VARIABLES) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  it('T76: requests the route under the base path with the event-stream accept header and every shared header', async () => {
    harness = await serve((_req, res) => {
      stream(res);
      res.end('event: session\ndata: {"a":1}\n\ndata: {"b":2}\n\n');
    });

    const frames = await collect(clientFor(harness.baseUrl));

    expect(frames).toEqual([
      { event: 'session', data: '{"a":1}' },
      { event: undefined, data: '{"b":2}' },
    ]);
    expect(harness.seen).toHaveLength(1);
    expect(harness.seen[0].url).toBe(`/logs${PATH}`);
    expect(harness.seen[0].headers).toMatchObject({
      accept: 'text/event-stream',
      'x-cs-cli': ANALYTICS_INFO,
      'x-cs-api-version': API_VERSION,
      authtoken: 'tok',
      'x-organization-uid': 'org1',
      'x-project-uid': 'proj1',
    });
  });

  it('T78: is not cut by an idle limit while heartbeats keep arriving for three times that long', async () => {
    harness = await serve((_req, res) => {
      stream(res);
      const beat = setInterval(() => res.write('data: \n\n'), 50);
      setTimeout(() => {
        clearInterval(beat);
        res.end();
      }, 600);
    });

    const frames = await collect(clientFor(harness.baseUrl, undefined, 200));

    expect(frames.length).toBeGreaterThanOrEqual(8);
    expect(frames.every((frame) => frame.data === '')).toBe(true);
  });

  it('T79: fails a stream that goes silent with a retryable network error and closes the socket', async () => {
    const timers = trackTimers(100);
    harness = await serve((_req, res) => {
      stream(res);
      res.write('data: first\n\n');
    });
    const frames: StreamFrame[] = [];

    const error = await clientFor(harness.baseUrl, undefined, 100)
      .open(SCOPE, (frame) => frames.push(frame))
      .catch((caught: unknown) => caught);

    await eventually(() => harness.closed() === 1);
    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect((error as LaunchNetworkError).retryable).toBe(true);
    expect((error as LaunchNetworkError).message).toBe(
      'The connection to the Launch API went quiet: nothing was received for 0.1 seconds.',
    );
    expect(frames).toEqual([{ event: undefined, data: 'first' }]);
    expect(harness.closed()).toBe(1);
    expect(timers.created()).toBeGreaterThan(0);
    expect(timers.pending()).toBe(0);
  });

  it('T79: also times out a server that accepts the request and never answers', async () => {
    harness = await serve(() => undefined);

    const error = await clientFor(harness.baseUrl, undefined, 80)
      .open(SCOPE, () => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect((error as LaunchNetworkError).retryable).toBe(true);
  });

  it('T79: reports a connection the server drops mid-stream as a retryable error', async () => {
    harness = await serve((_req, res) => {
      stream(res);
      res.write('data: first\n\n');
      setTimeout(() => res.socket?.destroy(), 20);
    });

    const error = await clientFor(harness.baseUrl).open(SCOPE, () => undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect((error as LaunchNetworkError).retryable).toBe(true);
  });

  it('T79: reports a refused connection as a retryable error', async () => {
    harness = await serve(() => undefined);
    const { baseUrl } = harness;
    await harness.stop();

    const error = await clientFor(baseUrl).open(SCOPE, () => undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect((error as LaunchNetworkError).retryable).toBe(true);
  });

  it('T79: rejects with the error a frame handler throws and closes the socket', async () => {
    harness = await serve((_req, res) => {
      stream(res);
      res.write('data: one\n\n');
    });
    const boom = new Error('handler failed');

    const error = await clientFor(harness.baseUrl)
      .open(SCOPE, () => {
        throw boom;
      })
      .catch((caught: unknown) => caught);

    await eventually(() => harness.closed() === 1);
    expect(error).toBe(boom);
    expect(harness.closed()).toBe(1);
  });

  it.each([
    [404, 'launch.DEPLOYMENT.NOT_FOUND'],
    [300, 'launch.UNKNOWN'],
  ])('T80: answers an open with status %i as a parsed error after exactly one request', async (status, code) => {
    harness = await serve((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        status === 404
          ? JSON.stringify({ errors: [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'gone' }] })
          : 'not json',
      );
    });

    const error = await collect(clientFor(harness.baseUrl)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchApiError);
    expect((error as LaunchApiError).status).toBe(status);
    expect((error as LaunchApiError).code).toBe(code);
    expect(harness.seen).toHaveLength(1);
  });

  it('T80: words a refusal from the messages it was given', async () => {
    harness = await serve((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ code: 'launch.X', message: 'raw' }] }));
    });

    const error = await clientFor(harness.baseUrl)
      .open(SCOPE, () => undefined, undefined, { 'launch.X': 'CLI words' })
      .catch((caught: unknown) => caught);

    expect((error as LaunchApiError).message).toBe('CLI words');
  });

  it('T80: treats 299 as an open stream and 200 as one too', async () => {
    harness = await serve((_req, res, index) => {
      stream(res, index === 0 ? 299 : 200);
      res.end(`data: from-${index}\n\n`);
    });
    const client = clientFor(harness.baseUrl);

    const first = await collect(client);
    const second = await collect(client);

    expect(first).toEqual([{ event: undefined, data: 'from-0' }]);
    expect(second).toEqual([{ event: undefined, data: 'from-1' }]);
  });

  it('T80: reads no more than the cap of a refusal body, so an oversized one falls back to the status wording', async () => {
    harness = await serve((_req, res) => {
      res.writeHead(502);
      res.end(JSON.stringify({ errors: [{ code: 'launch.BIG', message: 'x'.repeat(100_000) }] }));
    });

    const error = await collect(clientFor(harness.baseUrl)).catch((caught: unknown) => caught);

    expect((error as LaunchApiError).status).toBe(502);
    expect((error as LaunchApiError).code).toBe('launch.UNKNOWN');
  });

  it('T81: refreshes once on a 401 and retries with the new token', async () => {
    const stale = randomUUID();
    const fresh = randomUUID();
    let token = stale;
    const refresh = jest.fn(async () => {
      token = fresh;
    });
    harness = await serve((_req, res, index) => {
      if (index === 0) {
        res.writeHead(401).end();
        return;
      }
      stream(res);
      res.end('data: ok\n\n');
    });

    const frames = await collect(clientFor(harness.baseUrl, { headers: async () => ({ authtoken: token }), refresh }));

    expect(frames).toEqual([{ event: undefined, data: 'ok' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(harness.seen.map((request) => request.headers.authtoken)).toEqual([stale, fresh]);
  });

  it('T81: parses the error after exactly two requests when the 401 repeats', async () => {
    const refresh = jest.fn(async () => undefined);
    harness = await serve((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ code: 'launch.AUTH.EXPIRED', message: 'expired' }] }));
    });

    const error = await collect(clientFor(harness.baseUrl, { refresh })).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchApiError);
    expect((error as LaunchApiError).status).toBe(401);
    expect((error as LaunchApiError).code).toBe('launch.AUTH.EXPIRED');
    expect(harness.seen).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404])('T81: never refreshes the session for a %i', async (status) => {
    const refresh = jest.fn(async () => undefined);
    harness = await serve((_req, res) => {
      res.writeHead(status).end();
    });

    const error = await collect(clientFor(harness.baseUrl, { refresh })).catch((caught: unknown) => caught);

    expect((error as LaunchApiError).status).toBe(status);
    expect(refresh).not.toHaveBeenCalled();
    expect(harness.seen).toHaveLength(1);
  });

  it('T81: parses a 401 at once when the session cannot be refreshed', async () => {
    harness = await serve((_req, res) => {
      res.writeHead(401).end();
    });

    const error = await collect(clientFor(harness.baseUrl, { refresh: undefined })).catch((caught: unknown) => caught);

    expect((error as LaunchApiError).status).toBe(401);
    expect(harness.seen).toHaveLength(1);
  });

  it('T81: lets the failure of a refresh through and sends nothing more', async () => {
    harness = await serve((_req, res) => {
      res.writeHead(401).end();
    });

    const error = await collect(
      clientFor(harness.baseUrl, {
        refresh: async () => {
          throw new SessionExpiredError();
        },
      }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SessionExpiredError);
    expect(harness.seen).toHaveLength(1);
  });

  it('T81: lets the failure of the auth headers through and opens no connection', async () => {
    harness = await serve(() => undefined);
    const broken = new Error('no credentials');

    const error = await collect(
      clientFor(harness.baseUrl, {
        headers: async () => {
          throw broken;
        },
      }),
    ).catch((caught: unknown) => caught);

    expect(error).toBe(broken);
    expect(harness.seen).toEqual([]);
  });

  it('T82: tunnels the stream through the proxy with a CONNECT to the target', async () => {
    const connects: string[] = [];
    const proxy = createServer();
    proxy.on('connect', (req, client) => {
      connects.push(req.url as string);
      const [host, port] = (req.url as string).split(':');
      const upstream = connect(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client);
        client.pipe(upstream);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    harness = await serve((_req, res) => {
      stream(res);
      res.end('data: via-proxy\n\n');
    });
    process.env.HTTPS_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    try {
      const frames = await collect(clientFor(harness.baseUrl));

      expect(frames).toEqual([{ event: undefined, data: 'via-proxy' }]);
      expect(connects).toEqual([new URL(harness.baseUrl).host]);
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  it('T82: names the proxy and never its credentials when the proxy cannot be reached, without a retry hint', async () => {
    const user = `u${randomBytes(4).toString('hex')}`;
    const phrase = randomBytes(12).toString('hex');
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    process.env.HTTPS_PROXY = `http://${user}:${phrase}@127.0.0.1:${port}`;
    harness = await serve(() => undefined);

    const error = await collect(clientFor(harness.baseUrl)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LaunchNetworkError);
    expect((error as LaunchNetworkError).message).toBe(
      `Proxy error: Unable to connect to proxy server at http://127.0.0.1:${port}. Please verify your proxy configuration.`,
    );
    expect((error as LaunchNetworkError).message).not.toContain(phrase);
    expect((error as LaunchNetworkError).message).not.toContain(user);
    expect((error as LaunchNetworkError).retryable).toBe(false);
  });

  it('T83: aborting mid-stream rejects with the reason, destroys the socket and leaves no listener or timer', async () => {
    const timers = trackTimers(EVENT_STREAM_IDLE_TIMEOUT_MS);
    const stop = new AbortController();
    const reason = new Error('interrupted');
    harness = await serve((_req, res) => {
      stream(res);
      res.write('data: first\n\n');
    });

    const outcome = collect(clientFor(harness.baseUrl), stop.signal).catch((caught: unknown) => caught);
    await eventually(() => harness.seen.length === 1);
    setTimeout(() => stop.abort(reason), 30);
    const error = await outcome;

    await eventually(() => harness.closed() === 1);
    expect(error).toBe(reason);
    expect(harness.closed()).toBe(1);
    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(0);
    expect(timers.created()).toBeGreaterThan(0);
    expect(timers.pending()).toBe(0);
  });

  it('T83: aborting before the server answers destroys the request', async () => {
    const stop = new AbortController();
    harness = await serve(() => undefined);

    const outcome = collect(clientFor(harness.baseUrl), stop.signal).catch((caught: unknown) => caught);
    await eventually(() => harness.seen.length === 1);
    stop.abort(new Error('early'));

    expect(((await outcome) as Error).message).toBe('early');
    await eventually(() => harness.closed() === 1);
    expect(harness.closed()).toBe(1);
  });

  it('T83: an already aborted signal rejects at once and sends no request', async () => {
    const stop = new AbortController();
    const reason = new Error('before start');
    stop.abort(reason);
    harness = await serve(() => undefined);

    const error = await collect(clientFor(harness.baseUrl), stop.signal).catch((caught: unknown) => caught);

    expect(error).toBe(reason);
    expect(harness.seen).toEqual([]);
  });

  it('T83: a stream that ends normally removes its abort listener', async () => {
    const stop = new AbortController();
    harness = await serve((_req, res) => {
      stream(res);
      res.end('data: x\n\n');
    });

    await collect(clientFor(harness.baseUrl), stop.signal);

    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(0);
  });
});
