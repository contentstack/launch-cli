import { randomUUID } from 'crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import type { Server } from 'http';
import { createServer } from 'http';
import { request as httpRequest } from 'http';
import type { AddressInfo } from 'net';
import os, { tmpdir } from 'os';
import { dirname, join, win32 } from 'path';
import { pathToFileURL } from 'url';

import { answerRequestError, CloudFunctions, functionFilesImporting, isOutsideDirectory, listenFailure } from './cloud-functions';
import { PortInUseError } from './function.errors';
import * as loader from './load-data-url';
import { loadDataURL } from './load-data-url';

interface HttpResponse {
  status: number;
  body: string;
  cacheControl: string | undefined;
  contentType: string | undefined;
  location: string | undefined;
}

const originalStartServer = (CloudFunctions.prototype as never as Record<string, unknown>).startServer as (
  ...args: unknown[]
) => Promise<Server>;

let workspace: string;
let startedServers: Server[];
let loggedLines: string[];
let loggedErrors: unknown[];
let exitCodes: (number | undefined)[];

function writeProjectFile(relativePath: string, source: string): void {
  const absolutePath = join(workspace, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

function writeFunctionFile(relativePath: string, source: string): void {
  writeProjectFile(join('functions', relativePath), source);
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

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function sendRequest(port: number, path: string, { method = 'GET', headers = {}, body }: RequestOptions = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
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
          contentType: response.headers['content-type'],
          location: response.headers.location,
        });
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end(body);
  });
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'launch-cloud-functions-'));
  startedServers = [];
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
    .mockImplementation(async function (this: CloudFunctions, ...args: unknown[]) {
      const server = await originalStartServer.apply(this, args);
      startedServers.push(server);
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

    const handler = module.default;

    expect(typeof handler).toBe('function');
    expect(typeof handler === 'function' && handler()).toBe('ok');
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
    expect(exitCodes).toEqual([]);
    expect(startedServers).toHaveLength(0);
    expect(loggedLines).not.toContain('Detected Serverless Functions:');
  });

  it('ignores proxy edge files and unsupported extensions', async () => {
    writeFunctionFile('[proxy].edge.js', 'export default function proxy() {}');
    writeFunctionFile('notes.txt', 'not a function');
    writeFunctionFile('readme.md', '# not a function');
    const cloudFunctions = new CloudFunctions(workspace);

    await cloudFunctions.serve(await freePort());

    expect(loggedLines).toContain('No Serverless functions detected.');
    expect(exitCodes).toEqual([]);
    expect(startedServers).toHaveLength(0);
  });

  it('ignores a module whose default export is not a function', async () => {
    writeFunctionFile('constant.js', 'export const value = 1;');
    writeFunctionFile('object-default.js', 'export default { value: 1 };');
    const cloudFunctions = new CloudFunctions(workspace);

    await cloudFunctions.serve(await freePort());

    expect(loggedLines).toContain('No Serverless functions detected.');
    expect(exitCodes).toEqual([]);
    expect(startedServers).toHaveLength(0);
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
    expect(loggedLines).toEqual([
      'Detected Serverless Functions:',
      '  λ /hello',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
  });

  it('prints the port the server actually listens on when asked for port zero', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');

    const server = (await new CloudFunctions(workspace).serve(0)) as Server;
    const { port } = server.address() as AddressInfo;

    expect(port).not.toBe(0);
    expect(loggedLines).toContain(`Serving Cloud Functions at http://localhost:${port}`);
  });

  it('colours the serving url cyan when stdout is a terminal', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.end(); }');
    const port = await freePort();
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    try {
      await new CloudFunctions(workspace).serve(port);
    } finally {
      if (descriptor) {
        Object.defineProperty(process.stdout, 'isTTY', descriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    }

    expect(loggedLines).toContain(`Serving Cloud Functions at \u001b[36mhttp://localhost:${port}\u001b[39m`);
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
    expect(loggedLines).toContain('  λ /api/items/:id');
  });

  it('answers a post request on an exact route', async () => {
    writeFunctionFile('echo.js', 'export default function echo(request, response) { response.json({ method: request.method }); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/echo', { method: 'POST' });

    expect(JSON.parse(response.body)).toEqual({ method: 'POST' });
  });

  it('parses the cookie header into request.cookies', async () => {
    writeFunctionFile('cookies.js', 'export default function cookies(request, response) { response.json(request.cookies); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/cookies', { headers: { cookie: 'sid=abc; theme=dark%20mode' } });

    expect(JSON.parse(response.body)).toEqual({ sid: 'abc', theme: 'dark mode' });
  });

  it('gives request.cookies an empty object when no cookie header is sent', async () => {
    writeFunctionFile('cookies.js', 'export default function cookies(request, response) { response.json(request.cookies); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/cookies');

    expect(JSON.parse(response.body)).toEqual({});
  });

  it.each([
    ['application/json', '{"name":"launch","tags":["a","b"]}'],
    ['application/x-www-form-urlencoded', 'name=launch&tags[]=a&tags[]=b'],
  ])('hands a %s body to the handler as a parsed object', async (contentType, body) => {
    writeFunctionFile('body.js', 'export default function body(request, response) { response.json({ body: request.body }); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/body', { method: 'POST', headers: { 'content-type': contentType }, body });

    expect(JSON.parse(response.body)).toEqual({ body: { name: 'launch', tags: ['a', 'b'] } });
  });

  it.each(['text/plain', 'application/octet-stream'])(
    'hands a %s body over the 100kb parser default to the handler, as Lambda allows',
    async (contentType) => {
      writeFunctionFile('size.js', 'export default function size(request, response) { response.json({ length: request.body.length }); }');
      const body = 'a'.repeat(200 * 1024);
      const port = await freePort();

      await new CloudFunctions(workspace).serve(port);
      const response = await sendRequest(port, '/size', { method: 'POST', headers: { 'content-type': contentType }, body });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ length: body.length });
    },
  );

  it.each([
    ['application/json', (data: string) => JSON.stringify({ data })],
    ['application/x-www-form-urlencoded', (data: string) => `data=${data}`],
  ])('hands a %s body over the 100kb parser default to the handler parsed, as Lambda allows', async (contentType, encode) => {
    writeFunctionFile('size.js', 'export default function size(request, response) { response.json({ length: request.body.data.length }); }');
    const data = 'a'.repeat(200 * 1024);
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/size', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: encode(data),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ length: data.length });
  });

  it('hands a text/plain body to the handler as the raw string', async () => {
    writeFunctionFile('body.js', 'export default function body(request, response) { response.json({ body: request.body }); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/body', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'raw text',
    });

    expect(JSON.parse(response.body)).toEqual({ body: 'raw text' });
  });

  it('hands an application/octet-stream body to the handler as a buffer', async () => {
    writeFunctionFile(
      'binary.js',
      [
        'export default function binary(request, response) {',
        '  response.json({ isBuffer: Buffer.isBuffer(request.body), text: String(request.body) });',
        '}',
      ].join('\n'),
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/binary', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'binary data',
    });

    expect(JSON.parse(response.body)).toEqual({ isBuffer: true, text: 'binary data' });
  });

  it('warns about an import from outside the functions directory and still serves the function', async () => {
    writeProjectFile(join('shared', 'util.js'), 'export const greeting = "shared";');
    writeFunctionFile(
      join('api', 'x.js'),
      'import { greeting } from "../../shared/util.js"; export default function x(request, response) { response.send(greeting); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/api/x');

    expect(response.body).toBe('shared');
    expect(loggedLines).toContain(
      'warn: functions/api/x.js imports shared/util.js, which is outside functions/ and will not be available when deployed.',
    );
  });

  it('warns once, naming the shared helper that imports the outside file rather than each function using it', async () => {
    writeProjectFile('config.js', 'export const region = "na";');
    writeFunctionFile(join('lib', 'db.js'), 'import { region } from "../../config.js"; export const db = `db-${region}`;');
    writeFunctionFile('a.js', 'import { db } from "./lib/db.js"; export default function a(request, response) { response.send(db); }');
    writeFunctionFile('b.js', 'import { db } from "./lib/db.js"; export default function b(request, response) { response.send(db); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect(loggedLines).toEqual([
      'warn: functions/lib/db.js imports config.js, which is outside functions/ and will not be available when deployed.',
      'Detected Serverless Functions:',
      '  λ /a',
      '  λ /b',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
  });

  it('names the function, not an outside file, for an outside file reached through another outside file', async () => {
    writeProjectFile('config.js', 'export const region = "na";');
    writeProjectFile('other.js', 'import { region } from "./config.js"; export const label = `other-${region}`;');
    writeFunctionFile('a.js', 'import { label } from "../other.js"; export default function a(request, response) { response.send(label); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect(loggedLines).toEqual([
      'warn: functions/a.js imports other.js, which is outside functions/ and will not be available when deployed.',
      'warn: functions/a.js imports config.js, which is outside functions/ and will not be available when deployed.',
      'Detected Serverless Functions:',
      '  λ /a',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
  });

  it('warns about an outside file reached through a dynamic import', async () => {
    writeProjectFile('config.js', 'export const region = "na";');
    writeFunctionFile(
      'dyn.js',
      'export default async function dyn(request, response) { const { region } = await import("../config.js"); response.send(region); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect(loggedLines).toEqual([
      'warn: functions/dyn.js imports config.js, which is outside functions/ and will not be available when deployed.',
      'Detected Serverless Functions:',
      '  λ /dyn',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
  });

  it('names the commonjs function, not the bundler proxy, when it requires an outside es module', async () => {
    writeProjectFile('config.js', 'export const region = "na";');
    writeFunctionFile(
      'cjs.js',
      'const { region } = require("../config.js"); module.exports = function cjs(request, response) { response.send(region); };',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect(loggedLines).toEqual([
      'warn: functions/cjs.js imports config.js, which is outside functions/ and will not be available when deployed.',
      'Detected Serverless Functions:',
      '  λ /cjs',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
  });

  it('does not warn about a file in a functions subfolder whose name starts with two dots', async () => {
    writeFunctionFile(join('..shared', 'util.js'), 'export const greeting = "inside";');
    writeFunctionFile(
      'dots.js',
      'import { greeting } from "./..shared/util.js"; export default function dots(request, response) { response.send(greeting); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/dots');

    expect(response.body).toBe('inside');
    expect(loggedLines).toEqual([
      'Detected Serverless Functions:',
      '  λ /dots',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
  });

  it('does not warn about a package imported from node_modules', async () => {
    writeProjectFile(join('node_modules', 'fake-pkg', 'package.json'), '{"name":"fake-pkg","main":"index.js"}');
    writeProjectFile(join('node_modules', 'fake-pkg', 'index.js'), 'module.exports = { greeting: "from package" };');
    writeFunctionFile(
      'pkg.js',
      'import pkg from "fake-pkg"; export default function usesPkg(request, response) { response.send(pkg.greeting); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/pkg');

    expect(response.body).toBe('from package');
    expect(loggedLines).toEqual([
      'Detected Serverless Functions:',
      '  λ /pkg',
      '',
      `Serving Cloud Functions at http://localhost:${port}`,
    ]);
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

  it('sends the number given to res.send as the body with a 200 status, as deployed functions do', async () => {
    writeFunctionFile('count.js', 'export default function count(request, response) { response.send(42); }');
    writeFunctionFile('zero.js', 'export default function zero(request, response) { response.send(0); }');
    writeFunctionFile('teapot.js', 'export default function teapot(request, response) { response.status(201).send(418); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const count = await sendRequest(port, '/count');
    const zero = await sendRequest(port, '/zero');
    const teapot = await sendRequest(port, '/teapot');

    expect(count.status).toBe(200);
    expect(count.body).toBe('42');
    expect(zero.status).toBe(200);
    expect(zero.body).toBe('0');
    expect(teapot.status).toBe(201);
    expect(teapot.body).toBe('418');
    expect(loggedErrors).toEqual([]);
  });

  it('keeps the status of the two-argument res.send forms, as Express does', async () => {
    writeFunctionFile('missing.js', 'export default function missing(request, response) { response.send(404, "Not here"); }');
    writeFunctionFile('gone.js', 'export default function gone(request, response) { response.send("gone", 410); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const missing = await sendRequest(port, '/missing');
    const gone = await sendRequest(port, '/gone');

    expect(missing.status).toBe(404);
    expect(missing.body).toBe('Not here');
    expect(gone.status).toBe(410);
    expect(gone.body).toBe('gone');
    expect(loggedErrors).toEqual([]);
  });

  it('answers res.redirect(url) with a bare 307 and the location exactly as given, as deployed functions do', async () => {
    writeFunctionFile('go.js', 'export default function go(request, response) { response.redirect("/target?from=a b"); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/go');

    expect(response.status).toBe(307);
    expect(response.location).toBe('/target?from=a b');
    expect(response.body).toBe('');
    expect(response.contentType).toBeUndefined();
    expect(response.cacheControl).toBe('no-store');
  });

  it('answers res.redirect(status, url) with that status and no body', async () => {
    writeFunctionFile('moved.js', 'export default function moved(request, response) { response.redirect(301, "/new-home"); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/moved');

    expect(response.status).toBe(301);
    expect(response.location).toBe('/new-home');
    expect(response.body).toBe('');
    expect(response.contentType).toBeUndefined();
  });

  it('keeps 307 when a status follows the url, as deployed functions ignore it', async () => {
    writeFunctionFile('late.js', 'export default function late(request, response) { response.redirect("/after", 301); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/late');

    expect(response.status).toBe(307);
    expect(response.location).toBe('/after');
    expect(response.body).toBe('');
  });

  it('answers 500 and logs the deployed error message when res.redirect has no url', async () => {
    writeFunctionFile('nowhere.js', 'export default function nowhere(request, response) { response.redirect(301); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/nowhere');

    expect(response.status).toBe(500);
    expect(response.location).toBeUndefined();
    expect(loggedErrors).toHaveLength(1);
    expect((loggedErrors[0] as Error).message).toBe(
      "Invalid redirect arguments. Please use a single argument URL, e.g. res.redirect('/destination') or use a status code and URL, e.g. res.redirect(307, '/destination').",
    );
  });

  it('answers a malformed json body with a bare 400, no error page, and logs the rejection without the body', async () => {
    writeFunctionFile('body.js', 'export default function body(request, response) { response.json({ body: request.body }); }');
    const port = await freePort();
    const requestBody = `not-json-${randomUUID()}`;

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    });

    expect(response.status).toBe(400);
    expect(response.body).toBe('');
    expect(response.contentType).toBeUndefined();
    expect(response.cacheControl).toBe('no-store');
    expect(loggedErrors).toEqual(['Request rejected before the function ran: 400 entity.parse.failed']);
    expect(String(loggedErrors)).not.toContain(requestBody);
  });

  it('answers a body over the deployed payload limit with a bare 413 and no error page', async () => {
    writeFunctionFile('body.js', 'export default function body(request, response) { response.json({ body: request.body }); }');
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/body', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x'.repeat(6 * 1024 * 1024 + 1),
    });

    expect(response.status).toBe(413);
    expect(response.body).toBe('');
    expect(response.contentType).toBeUndefined();
    expect(response.cacheControl).toBe('no-store');
    expect(loggedErrors).toEqual(['Request rejected before the function ran: 413 entity.too.large']);
  });

  it('answers a request error that carries no status with a bare 500', () => {
    const end = jest.fn();
    const status = jest.fn(() => ({ end }));
    const next = jest.fn();
    const error = new Error('no status');

    answerRequestError(error, {} as never, { headersSent: false, status } as never, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(end).toHaveBeenCalledWith();
    expect(next).not.toHaveBeenCalled();
    expect(loggedErrors).toEqual(['Request rejected before the function ran: 500 Error']);
  });

  it('hands a request error to express once the response has started', () => {
    const status = jest.fn();
    const next = jest.fn();
    const error = Object.assign(new Error('late'), { status: 400 });

    answerRequestError(error, {} as never, { headersSent: true, status } as never, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(status).not.toHaveBeenCalled();
    expect(loggedErrors).toEqual([]);
  });

  it('removes its temporary bundles once the functions are loaded, whether loading succeeds or fails', async () => {
    const mkdtemp = jest.spyOn(fs, 'mkdtempSync');
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');
    await new CloudFunctions(workspace).serve(await freePort());
    writeFunctionFile('zzz-boom.js', 'throw new Error("init"); export default function boom() {}');
    await new CloudFunctions(workspace).serve(await freePort()).catch(() => undefined);

    const bundleDirectories = mkdtemp.mock.results.map((result) => String(result.value));
    expect(bundleDirectories).toHaveLength(2);
    expect(bundleDirectories.filter((directory) => existsSync(directory))).toEqual([]);
  });

  it('imports bundles from the real path of a symlinked temp directory, so mapped stack paths exist', async () => {
    const realTemp = realpathSync(mkdtempSync(join(tmpdir(), 'launch-real-temp-')));
    const linkedTemp = join(workspace, 'linked-temp');
    symlinkSync(realTemp, linkedTemp);
    jest.spyOn(os, 'tmpdir').mockReturnValue(linkedTemp);
    const load = jest.spyOn(loader, 'loadDataURL');
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');

    await new CloudFunctions(workspace).serve(await freePort());
    rmSync(realTemp, { recursive: true, force: true });

    const loadedFrom = String(load.mock.calls[0][0]);
    expect(loadedFrom.startsWith(pathToFileURL(realTemp).href)).toBe(true);
  });

  it('logs a handler error with a stack pointing at the function source file and line', async () => {
    const sourceMaps = jest.spyOn(process, 'setSourceMapsEnabled');
    writeFunctionFile('broken.js', ['export default function broken() {', '  throw new Error("handler blew up");', '}'].join('\n'));
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    await sendRequest(port, '/broken');

    const stack = String((loggedErrors[0] as Error).stack);
    expect(stack).toContain(`${join('functions', 'broken.js')}:2:`);
    expect(stack).not.toContain('data:text/javascript');
    expect(sourceMaps).toHaveBeenCalledWith(true);
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

  it('loads the env file beside the functions directory before the functions load', async () => {
    const envValue = randomUUID();
    writeFileSync(join(workspace, '.env'), `LAUNCH_TEST_VALUE=${envValue}\n`);
    writeFunctionFile(
      'env.js',
      [
        'const atLoad = process.env.LAUNCH_TEST_VALUE;',
        'export default function env(request, response) {',
        '  response.json({ atRequest: process.env.LAUNCH_TEST_VALUE, atLoad });',
        '}',
      ].join('\n'),
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/env');

    expect(JSON.parse(response.body)).toEqual({ atRequest: envValue, atLoad: envValue });
    delete process.env.LAUNCH_TEST_VALUE;
  });
});

describe('functionFilesImporting', () => {
  it('follows virtual importers to function files and stops on a cycle between virtual modules', () => {
    const importersById = new Map<string, readonly string[]>([
      ['/project/config.js', ['\0config.js?proxy-a']],
      ['\0config.js?proxy-a', ['\0config.js?proxy-b', '/project/functions/a.js']],
      ['\0config.js?proxy-b', ['\0config.js?proxy-a']],
    ]);

    expect(functionFilesImporting('/project/config.js', importersById, '/project/functions')).toEqual([
      '/project/functions/a.js',
    ]);
  });
});

describe('isOutsideDirectory', () => {
  it('treats a file on another Windows drive as outside the directory', () => {
    expect(isOutsideDirectory('C:\\app\\functions', 'D:\\lib\\a.js', win32)).toBe(true);
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

  it('gives the file, line and column of a syntax error', async () => {
    writeFunctionFile('syn.js', ['export default function syn() {', '  const = 1;', '}'].join('\n'));

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow(
      `(${join('functions', 'syn.js')}:2:`,
    );
  });

  it('gives the file, line and column where a function throws while loading', async () => {
    writeFunctionFile('te.js', ['const cfg = undefined;', 'const value = cfg.value;', 'export default function te() {}'].join('\n'));

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow(
      `(${join('functions', 'te.js')}:2:`,
    );
  });

  it('gives no location rather than a realpath error when the bundler reports a virtual module', () => {
    const virtualModuleError = Object.assign(new Error('boom'), { loc: { file: '\0virtual-module', line: 1, column: 1 } });

    expect(new CloudFunctions(workspace)['sourceLocation'](virtualModuleError)).toBeUndefined();
  });

  it('keeps a thrown non-error value in the load failure message', async () => {
    writeFunctionFile('str.js', 'throw "plain string"; export default function str() {}');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow(
      `Could not load ${join('functions', 'str.js')}: plain string`,
    );
  });

  it('names the function file when it cannot be bundled', async () => {
    writeFunctionFile('syntax-error.js', 'export default function ( {');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow(
      `Could not load ${join('functions', 'syntax-error.js')}: `,
    );
    expect(startedServers).toHaveLength(0);
  });

  it('names the function file when it throws while loading', async () => {
    writeFunctionFile(join('api', 'boom.js'), 'throw new Error("init"); export default function boom() {}');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow(
      `Could not load ${join('functions', 'api', 'boom.js')}: init`,
    );
    expect(startedServers).toHaveLength(0);
  });

  it('names the package and the file importing it when a package is not installed, without a bundler warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const needs = join('functions', 'api', 'needs.js');
    writeFunctionFile(
      join('api', 'needs.js'),
      'import pkg from "not-installed-pkg"; export default function needs(request, response) { response.send(pkg); }',
    );

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toMatchObject({
      message: `${needs} imports "not-installed-pkg", which is not installed. Run npm install in the project.`,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the commonjs function file when it requires a package that is not installed', async () => {
    const cjs = join('functions', 'cjs.js');
    writeFunctionFile(
      'cjs.js',
      'const x = require("not-installed-cjs"); module.exports = function cjs(request, response) { response.send(x); };',
    );

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toMatchObject({
      message: `${cjs} imports "not-installed-cjs", which is not installed. Run npm install in the project.`,
    });
  });

  it('serves a function importing a node: builtin missing from builtinModules, such as node:sqlite', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFunctionFile(
      'sq.js',
      'import { DatabaseSync } from "node:sqlite"; export default function sq(request, response) { response.send(typeof DatabaseSync); }',
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);

    expect((await sendRequest(port, '/sq')).body).toBe('function');
  });

  it('still serves a function that guards a dynamic import of a package that is not installed', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFunctionFile(
      'opt.js',
      [
        'export default async function opt(request, response) {',
        '  let peer = null;',
        '  try { peer = await import("optional-peer"); } catch { peer = null; }',
        '  response.json({ hasPeer: peer !== null });',
        '}',
      ].join('\n'),
    );
    const port = await freePort();

    await new CloudFunctions(workspace).serve(port);
    const response = await sendRequest(port, '/opt');

    expect(JSON.parse(response.body)).toEqual({ hasPeer: false });
  });

  it('rejects when a function file imports a module that cannot be resolved', async () => {
    writeFunctionFile('missing-import.js', 'import missing from "../util/cloud-function/not-here.js"; export default missing;');

    await expect(new CloudFunctions(workspace).serve(await freePort())).rejects.toThrow();
  });

  it('refuses with a port-in-use error rather than an unhandled error event', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, () => resolve()));

    const failure = await new CloudFunctions(workspace).serve(port).catch((error: Error) => error);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));

    expect(failure).toBeInstanceOf(PortInUseError);
    expect((failure as Error).message).toContain(String(port));
    expect((failure as Error).message).toContain('--port');
  });

  it('maps a port clash to a port-in-use error naming the port', () => {
    const clash = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });

    const mapped = listenFailure(clash, 4321);

    expect(mapped).toBeInstanceOf(PortInUseError);
    expect(mapped.message).toContain('4321');
  });

  it('passes a listen failure that is not a port clash through untouched', () => {
    const other = Object.assign(new Error('listen EACCES'), { code: 'EACCES' });

    const mapped = listenFailure(other, 4321);

    expect(mapped).toBe(other);
    expect(mapped).not.toBeInstanceOf(PortInUseError);
  });

  it('leaves an error raised after the server is listening unhandled, exactly as V1 did, so the process exits 1', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = (await new CloudFunctions(workspace).serve(await freePort())) as Server;
    const late = new Error('late failure');

    expect(server.listenerCount('error')).toBe(0);
    expect(() => server.emit('error', late)).toThrow(/late failure/);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('propagates a listen failure that is not a port clash', async () => {
    writeFunctionFile('hello.js', 'export default function hello(request, response) { response.send("hi"); }');

    const failure = await new CloudFunctions(workspace).serve(-1).catch((error: Error) => error);

    expect((failure as Error).name).toBe('RangeError');
    expect(failure).not.toBeInstanceOf(PortInUseError);
  });
});
