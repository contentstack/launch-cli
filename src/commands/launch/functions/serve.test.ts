import Contentfly from '../../../util/cloud-function';
import Functions from './serve';

jest.mock('../../../util/cloud-function');

const INVALID_PORT_MESSAGE = 'Invalid port number. Please provide a valid port number between 0 and 65535.';

const loggedMessages: string[] = [];
const constructedWith: string[] = [];
const servedPorts: number[] = [];
let serveResult: () => Promise<void>;
let originalParse: (typeof Functions.prototype)['parse'];
const originalPort = process.env.PORT;

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

afterEach(() => {
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
    expect(Functions.flags['data-dir']).toMatchObject({ char: 'd', description: 'Current working directory' });
    expect(Functions.flags['data-dir'].default).toBeUndefined();
  });
});

describe('launch:functions:serve init', () => {
  it('stores the supplied data directory and port', async () => {
    const command = commandWithFlags({ 'data-dir': '/path/to/data/dir', port: '4000' });

    await command.init();

    expect(Functions.prototype['parse']).toHaveBeenCalledWith(Functions);
    expect(command['sharedConfig']).toEqual({ projectBasePath: '/path/to/data/dir', port: 4000 });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('falls back to the working directory when data-dir is %s', async (_label, dataDir) => {
    const command = commandWithFlags({ 'data-dir': dataDir, port: '3000' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: process.cwd(), port: 3000 });
  });

  it.each(['0', '1', '3000', '65535'])('accepts the boundary port %s', async (port) => {
    const command = commandWithFlags({ 'data-dir': '/data', port });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: '/data', port: Number(port) });
    expect(loggedMessages).toEqual([]);
  });

  it.each(['', ' '])('treats the blank port %p as port zero', async (port) => {
    const command = commandWithFlags({ 'data-dir': '/data', port });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: '/data', port: 0 });
    expect(loggedMessages).toEqual([]);
  });

  it.each(['-1', '65536', '3000.5', 'abc', 'NaN', '1e400'])('rejects the invalid port %p', async (port) => {
    const command = commandWithFlags({ 'data-dir': '/data', port });

    await expect(command.init()).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(loggedMessages).toEqual([INVALID_PORT_MESSAGE]);
    expect(command['sharedConfig']).toBeUndefined();
  });

  it('prefers the PORT environment variable over the port flag', async () => {
    process.env.PORT = '5000';
    const command = commandWithFlags({ 'data-dir': '/data', port: '3000' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: '/data', port: 5000 });
  });

  it('falls back to the port flag when PORT is an empty string', async () => {
    process.env.PORT = '';
    const command = commandWithFlags({ 'data-dir': '/data', port: '4200' });

    await command.init();

    expect(command['sharedConfig']).toEqual({ projectBasePath: '/data', port: 4200 });
  });

  it.each(['notANumber', '999999', '-200'])('rejects the invalid PORT environment value %p', async (value) => {
    process.env.PORT = value;
    const command = commandWithFlags({ 'data-dir': '/data', port: '3000' });

    await expect(command.init()).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(loggedMessages).toEqual([INVALID_PORT_MESSAGE]);
  });

  it('propagates a rejection raised while parsing', async () => {
    Functions.prototype['parse'] = jest.fn().mockRejectedValue(new Error('parse failed'));
    const command = new Functions([], {} as never);

    await expect(command.init()).rejects.toThrow('parse failed');
    expect(loggedMessages).toEqual([]);
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
