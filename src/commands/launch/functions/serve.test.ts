import { cliux } from '@contentstack/cli-utilities';
import { Errors, Parser } from '@oclif/core';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EXIT_RUNTIME, EXIT_USAGE } from '../../../core/constants';
import Contentfly from '../../../functions/index';
import { PortInUseError } from '../../../functions/function.errors';
import Functions from './serve';

jest.mock('../../../functions');

const INVALID_PORT_MESSAGE = 'Invalid port number. Please provide a valid port number between 0 and 65535.';

const loggedMessages: string[] = [];
const constructedWith: string[] = [];
const servedPorts: number[] = [];
let serveResult: () => Promise<void>;
let originalParse: (typeof Functions.prototype)['parse'];
const originalPort = process.env.PORT;
const temporaryDirectories: string[] = [];
let stdout: string[];

function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launch-serve-'));
  temporaryDirectories.push(dir);
  return dir;
}

function logFiles(dir: string): string[] {
  const logs = join(dir, 'logs');
  return existsSync(logs) ? readdirSync(logs).sort() : [];
}

function readLog(dir: string, name: string): string {
  const path = join(dir, 'logs', name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition never became true');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function commandWithFlags(flags: Record<string, unknown>): Functions {
  Functions.prototype['parse'] = jest.fn().mockResolvedValue({ flags });
  return new Functions([], {} as never);
}

beforeEach(() => {
  loggedMessages.length = 0;
  constructedWith.length = 0;
  servedPorts.length = 0;
  serveResult = async () => undefined;
  originalParse = Functions.prototype['parse'];
  delete process.env.PORT;
  stdout = [];
  jest.spyOn((console as unknown as { _stdout: NodeJS.WriteStream })._stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });

  jest.spyOn(Functions.prototype, 'log').mockImplementation((message?: string) => {
    loggedMessages.push(message as string);
  });

  (Contentfly as unknown as jest.Mock).mockImplementation((projectBasePath: string) => {
    constructedWith.push(projectBasePath);
    return {
      serveCloudFunctions: async (port: number) => {
        servedPorts.push(port);
        return serveResult();
      },
    };
  });
});

afterEach(async () => {
  for (const dir of temporaryDirectories.splice(0)) {
    if (existsSync(join(dir, 'logs'))) {
      await eventually(() => logFiles(dir).length === 2);
    }

    rmSync(dir, { recursive: true, force: true });
  }

  Functions.prototype['parse'] = originalParse;
  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

describe('launch:functions:serve flag definitions', () => {
  it('describes the command and its examples', () => {
    expect(Functions.description).toBe('Serve cloud functions');
    expect(Functions.examples).toEqual([
      '$ csdx launch:functions:serve',
      '$ csdx launch:functions:serve --port <port-number>',
      '$ csdx launch:functions:serve --data-dir <path/of/current/working/dir>',
      '$ csdx launch:functions:serve --data-dir <path/of/current/working/dir> -p <port-number>',
    ]);
  });

  it('declares a port flag defaulting to 3000 and a data-dir flag', () => {
    expect(Functions.flags.port).toMatchObject({ char: 'p', default: '3000', description: 'Port number' });
    expect(Functions.flags.port.env).toBeUndefined();
    expect(Functions.flags['data-dir']).toMatchObject({ char: 'd', description: 'Current working directory' });
    expect(Functions.flags['data-dir'].default).toBeUndefined();
  });
});

describe('launch:functions:serve init', () => {
  it('stores the supplied data directory and port and creates the project log files there', async () => {
    const dataDir = temporaryDirectory();
    const command = commandWithFlags({ 'data-dir': dataDir, port: '4000' });

    await command.init();

    expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
    expect(command['sharedConfig']).toEqual({ projectBasePath: dataDir, port: 4000 });
    expect(existsSync(join(dataDir, 'logs'))).toBe(true);
    await eventually(() => logFiles(dataDir).length === 2);
    expect(logFiles(dataDir)).toEqual(['error.log', 'info.log']);
    expect(readLog(dataDir, 'error.log')).toBe('');
    expect(stdout).toEqual([]);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('falls back to the working directory when data-dir is %s', async (_label, dataDir) => {
    const workingDirectory = temporaryDirectory();
    jest.spyOn(process, 'cwd').mockReturnValue(workingDirectory);
    const command = commandWithFlags({ 'data-dir': dataDir, port: '3000' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: workingDirectory, port: 3000 });
    expect(existsSync(join(workingDirectory, 'logs'))).toBe(true);
  });

  it.each(['0', '1', '3000', '65535'])('accepts the boundary port %s', async (port) => {
    const dataDir = temporaryDirectory();
    const command = commandWithFlags({ 'data-dir': dataDir, port });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: dataDir, port: Number(port) });
    await eventually(() => logFiles(dataDir).length === 2);
    expect(readLog(dataDir, 'error.log')).toBe('');
    expect(stdout).toEqual([]);
  });

  it.each(['-1', '65536', '3000.5', 'abc', 'NaN', '1e400', '', '   '])(
    'rejects the invalid port %p once through the project logger and exits 1 as v1 did',
    async (port) => {
      const dataDir = temporaryDirectory();
      const command = commandWithFlags({ 'data-dir': dataDir, port });

      const failure = await command.init().catch((error: Error & { oclif?: { exit?: number } }) => error);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT_RUNTIME } });
      expect((failure as Error).message).not.toContain(INVALID_PORT_MESSAGE);
      expect(command['sharedConfig']).toBeUndefined();
      expect(stdout).toEqual([`\u001b[31merror: ${INVALID_PORT_MESSAGE}\u001b[39m\n`]);
      await eventually(() => readLog(dataDir, 'error.log') !== '');
      expect(readLog(dataDir, 'error.log')).toBe(`{"level":"error","message":"${INVALID_PORT_MESSAGE}"}\n`);
      expect(readLog(dataDir, 'info.log')).toBe('');
    },
  );

  it('exits 1 with the invalid base path error before validating the port when the data directory does not exist', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const missing = join(temporaryDirectory(), 'no-such-dir');
    const command = commandWithFlags({ 'data-dir': missing, port: '99999' });

    await expect(command.init()).rejects.toThrow('exit 1');

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stdout).toEqual(['\u001b[31merror: Provided base path is not valid\u001b[39m\n']);
    expect(existsSync(missing)).toBe(false);
    expect(command['sharedConfig']).toBeUndefined();
  });

  it('routes the command log through the project logger', async () => {
    const dataDir = temporaryDirectory();
    const print = jest.spyOn(cliux, 'print').mockImplementation(() => undefined);
    const command = commandWithFlags({ 'data-dir': dataDir, port: '3000' });
    await command.init();

    command.log('plain');

    expect(print.mock.calls).toEqual([['plain', {}]]);
    expect(loggedMessages).toEqual([]);
  });

  it('propagates a rejection raised while parsing', async () => {
    Functions.prototype['parse'] = jest.fn().mockRejectedValue(new Error('parse failed'));
    const command = new Functions([], {} as never);

    await expect(command.init()).rejects.toThrow('parse failed');
    expect(loggedMessages).toEqual([]);
    expect(stdout).toEqual([]);
  });
});

describe('launch:functions:serve run', () => {
  it('serves the stored base path on the stored port', async () => {
    const command = new Functions([], {} as never);
    command['sharedConfig'] = { projectBasePath: '/path/to/data/dir', port: 4000 };

    await command.run();

    expect(constructedWith).toEqual(['/path/to/data/dir']);
    expect(servedPorts).toEqual([4000]);
  });

  it('serves port zero rather than treating it as absent', async () => {
    const command = new Functions([], {} as never);
    command['sharedConfig'] = { projectBasePath: '/data', port: 0 };

    await command.run();

    expect(servedPorts).toEqual([0]);
  });

  it('reports a port already in use as a usage error rather than a stack trace', async () => {
    serveResult = async () => {
      throw new PortInUseError(4000);
    };
    const command = new Functions([], {} as never);
    command['sharedConfig'] = { projectBasePath: '/data', port: 4000 };

    const failure = await command.run().catch((error: Error & { oclif?: { exit?: number } }) => error);

    expect(failure).toMatchObject({ oclif: { exit: EXIT_USAGE } });
    expect((failure as Error).message).toContain('Port 4000 is already in use');
    expect((failure as Error).message).toContain('--port');
  });

  it('propagates a rejection raised while serving', async () => {
    serveResult = async () => {
      throw new Error('no functions directory');
    };
    const command = new Functions([], {} as never);
    command['sharedConfig'] = { projectBasePath: '/data', port: 4000 };

    await expect(command.run()).rejects.toThrow('no functions directory');
    expect(constructedWith).toEqual(['/data']);
    expect(servedPorts).toEqual([4000]);
  });
});

describe('launch:functions:serve port precedence', () => {
  it('lets the PORT environment variable beat an explicit --port as v1 did', async () => {
    const dataDir = temporaryDirectory();
    process.env.PORT = '4557';
    const command = commandWithFlags({ 'data-dir': dataDir, port: '4558' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: dataDir, port: 4557 });
  });

  it('falls through to --port when PORT is set to an empty string', async () => {
    const dataDir = temporaryDirectory();
    process.env.PORT = '';
    const command = commandWithFlags({ 'data-dir': dataDir, port: '4559' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: dataDir, port: 4559 });
    expect(stdout).toEqual([]);
  });

  it('uses --port when PORT is not set', async () => {
    const dataDir = temporaryDirectory();
    const command = commandWithFlags({ 'data-dir': dataDir, port: '4560' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: dataDir, port: 4560 });
  });

  it.each(['70000', 'abc', '   '])(
    'rejects an invalid PORT %p even when --port is valid, because PORT wins',
    async (env) => {
      const dataDir = temporaryDirectory();
      process.env.PORT = env;
      const command = commandWithFlags({ 'data-dir': dataDir, port: '4000' });

      const failure = await command.init().catch((error: Error & { oclif?: { exit?: number } }) => error);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT_RUNTIME } });
      expect(command['sharedConfig']).toBeUndefined();
      expect(stdout).toEqual([`\u001b[31merror: ${INVALID_PORT_MESSAGE}\u001b[39m\n`]);
    },
  );

  it('leaves the PORT environment variable out of flag parsing so the command alone applies it', async () => {
    process.env.PORT = '4711';

    const { flags } = await Parser.parse([], { flags: Functions.flags });

    expect(flags.port).toBe('3000');
  });
});
