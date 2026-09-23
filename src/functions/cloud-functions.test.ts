import { randomUUID } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, Server } from 'http';
import { request as httpRequest } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { CloudFunctions } from './cloud-functions';
import { loadDataURL } from './load-data-url';

interface HttpResponse {
  status: number;
  body: string;
  cacheControl: string | undefined;
}

const originalStartServer = (CloudFunctions.prototype as never as Record<string, unknown>).startServer as (
  ...args: unknown[]
) => Server;

let workspace: string;
let startedServers: Server[];
let serverErrors: NodeJS.ErrnoException[];
let loggedLines: string[];
let loggedErrors: unknown[];
let exitCodes: (number | undefined)[];

function writeFunctionFile(relativePath: string, source: string): void {
  const absolutePath = join(workspace, 'functions', relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function sendRequest(port: number, path: string, method = 'GET'): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest({ host: '127.0.0.1', port, path, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode as number,
          body,
          cacheControl: response.headers['cache-control'],
        });
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end();
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition was never met');
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'launch-cloud-functions-'));
  startedServers = [];
  serverErrors = [];
  loggedLines = [];
  loggedErrors = [];
  exitCodes = [];

  jest.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    loggedLines.push(String(message));
  });
  jest.spyOn(console, 'error').mockImplementation((error?: unknown) => {
    loggedErrors.push(error);
  });
  jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code);
    return undefined as never;
  }) as never);

  jest
    .spyOn(CloudFunctions.prototype as never as Record<string, unknown>, 'startServer' as never)
    .mockImplementation(function (this: CloudFunctions, ...args: unknown[]) {
      const server = originalStartServer.apply(this, args);
      startedServers.push(server);
      server.on('error', (error: NodeJS.ErrnoException) => {
        serverErrors.push(error);
      });
      return server;
    } as never);
});

afterEach(async () => {
  await Promise.all(
    startedServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  rmSync(workspace, { recursive: true, force: true });
  jest.restoreAllMocks();
});

function toDataURL(source: string): string {
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}

describe('loadDataURL', () => {
  it('resolves the module namespace of a data url module', async () => {
    expect((await loadDataURL(toDataURL('export const answer = 42;'))).answer).toBe(42);
  });

  it('exposes a default exported function that can be invoked', async () => {
    const module = await loadDataURL(toDataURL('export default function handler() { return "ok"; }'));

    expect(typeof module.default).toBe('function');
    expect(module.default()).toBe('ok');
  });

  it('rejects when the data url holds a syntax error', async () => {
    await expect(loadDataURL(toDataURL('export default function ('))).rejects.toMatchObject({ name: 'SyntaxError' });
  });

  it('rejects when the argument is not an importable url', async () => {
    await expect(loadDataURL('not-a-url')).rejects.toMatchObject({ name: 'Error' });
  });
});

describe('CloudFunctions serve directory handling', () => {
  it('rejects when the functions directory is absent', async () => {
    const cloudFunctions = new CloudFunctions(workspace);

    await expect(cloudFunctions.serve(await freePort())).rejects.toMatchObject({
      name: 'FunctionsDirectoryNotFound',
      message: `No functions directory found at '${workspace}'.`,
    });
    expect(startedServers).toHaveLength(0);
  });

  it('reports no functions and exits when the directory is empty', async () => {
    mkdirSync(join(workspace, 'functions'));
    const cloudFunctions = new CloudFunctions(workspace);

    await cloudFunctions.serve(await freePort());

    expect(loggedLines).toContain('No Serverless functions detected.');
    expect(exitCodes).toEqual([0]);
    expect(loggedLines).not.toContain('Detected Serverless functions...');
  });

  it('ignores proxy edge files and unsupported extensions', async () => {
    writeFunctionFile('[proxy].edge.js', 'export default function proxy() {}');
    writeFunctionFile('notes.txt', 'not a function');
    writeFunctionFile('readme.md', '# not a function');
    const cloudFunctions = new CloudFunctions(workspace);

    await cloudFunctions.serve(await freePort());

    expect(loggedLines).toContain('No Serverless functions detected.');
    expect(exitCodes).toEqual([0]);
  });

  it('ignores a module whose default export is not a function', async () => {
    writeFunctionFile('constant.js', 'export const value = 1;');
    writeFunctionFile('object-default.js', 'export default { value: 1 };');
    const cloudFunctions = new CloudFunctions(workspace);

    await cloudFunctions.serve(await freePort());

    expect(loggedLines).toContain('No Serverless functions detected.');
    expect(exitCodes).toEqual([0]);
  });

  it('strips leading parent traversal from the functions directory path', async () => {
    const cloudFunctions = new CloudFunctions('../../absent-project');

    await expect(cloudFunctions.serve(await freePort())).rejects.toMatchObject({
      message: 'No functions directory found at \'../../absent-project\'.',
    });
  });
});

describe('CloudFunctions serve routing', () => {
  it('serves an es module default export on an exact route', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.json({ ok: true }); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/hello');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(loggedLines).toContain('Detected Serverless functions...');
    expect(loggedLines).toContain('λ /hello \n');
    await waitFor(() => loggedLines.includes(`Serving on port ${port}`));
  });

  it('serves a commonjs default export', async () => {
    writeFunctionFile('legacy.js', 'module.exports = function legacy(request, response) { response.send("legacy"); };');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/legacy');

    expect(response.status).toBe(200);
    expect(response.body).toBe('legacy');
  });

  it('serves a commonjs module that exports its handler as a default property', async () => {
    writeFunctionFile('interop.js', 'exports.default = function interop(request, response) { response.send("interop"); };');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/interop');

    expect(response.status).toBe(200);
    expect(response.body).toBe('interop');
  });

  it('serves a nested dynamic route and passes the path parameter through', async () => {
    writeFunctionFile(
      join('api', 'items', '[id].js'),
      'export default function item(request, response) { response.json({ id: request.params.id }); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/api/items/42');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ id: '42' });
    expect(loggedLines).toContain('λ /api/items/:id \n');
  });

  it('answers a post request on an exact route', async () => {
    writeFunctionFile('echo.js', 'export default function echo(request, response) { response.json({ method: request.method }); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/echo', 'POST');

    expect(JSON.parse(response.body)).toEqual({ method: 'POST' });
  });

  it('answers 404 for a path no function claims', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect((await sendRequest(port, '/absent')).status).toBe(404);
  });

  it('defaults cache-control to no-store and keeps a header the handler set', async () => {
    writeFunctionFile('plain.js', 'export default function plain(request, response) { response.send("plain"); }');
    writeFunctionFile(
      'cached.js',
      'export default function cached(request, response) { response.setHeader("cache-control", "max-age=60"); response.send("cached"); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect((await sendRequest(port, '/plain')).cacheControl).toBe('no-store');
    expect((await sendRequest(port, '/cached')).cacheControl).toBe('max-age=60');
  });

  it('answers 500 and logs when a handler throws', async () => {
    writeFunctionFile('broken.js', 'export default function broken() { throw new Error("handler blew up"); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/broken');

    expect(response.status).toBe(500);
    expect(loggedErrors).toHaveLength(1);
    expect((loggedErrors[0] as Error).message).toBe('handler blew up');
  });

  it('loads the env file that sits beside the functions directory', async () => {
    const envValue = randomUUID();
    writeFileSync(join(workspace, '.env'), `LAUNCH_TEST_VALUE=${envValue}\n`);
    writeFunctionFile(
      'env.js',
      'export default function env(request, response) { response.json({ value: process.env.LAUNCH_TEST_VALUE }); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/env');

    expect(JSON.parse(response.body)).toEqual({ value: envValue });
    delete process.env.LAUNCH_TEST_VALUE;
  });
});

describe('CloudFunctions serve failures', () => {
  it('rejects with the validation error the validator raised', async () => {
    writeFunctionFile('[id].js', 'export default function top(request, response) { response.send("top"); }');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toMatchObject({
      name: 'TopLevelDynamicRouteError',
    });
    expect(startedServers).toHaveLength(0);
  });

  it('rejects when a function file cannot be bundled', async () => {
    writeFunctionFile('syntax-error.js', 'export default function ( {');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow();
    expect(startedServers).toHaveLength(0);
  });

  it('rejects when a function file imports a module that cannot be resolved', async () => {
    writeFunctionFile('missing-import.js', 'import missing from "../util/cloud-function/not-here.js"; export default missing;');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow();
  });

  it('surfaces an address-in-use error on the server it started', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, () => resolve()));

    await new CloudFunctions(workspace).serve(port);
    await waitFor(() => serverErrors.length > 0);

    expect(serverErrors[0].code).toBe('EADDRINUSE');
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });
});
