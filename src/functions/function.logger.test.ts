import { cliux } from '@contentstack/cli-utilities';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import winston from 'winston';

import { Logger } from './function.logger';

const created: Logger[] = [];
let projectBasePath: string;
let stdout: string[];

function loggerAt(path: string): Logger {
  const logger = new Logger({ projectBasePath: path });
  created.push(logger);
  return logger;
}

function winstonLoggers(logger: Logger): { info: winston.Logger; error: winston.Logger } {
  return { info: logger['infoLogger'], error: logger['errorLogger'] };
}

function fileTransport(logger: winston.Logger): winston.transports.FileTransportInstance {
  return logger.transports.find((transport) => transport instanceof winston.transports.File) as winston.transports.FileTransportInstance;
}

function consoleTransport(logger: winston.Logger): winston.transports.ConsoleTransportInstance {
  return logger.transports.find((transport) => transport instanceof winston.transports.Console) as winston.transports.ConsoleTransportInstance;
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

function read(name: string): string {
  const path = join(projectBasePath, 'logs', name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function fileNames(): string[] {
  return readdirSync(join(projectBasePath, 'logs')).sort();
}

beforeEach(() => {
  projectBasePath = mkdtempSync(join(tmpdir(), 'launch-serve-log-'));
  stdout = [];
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  for (const logger of created.splice(0)) {
    const { info, error } = winstonLoggers(logger);
    info.close();
    error.close();
  }

  await new Promise((resolve) => setTimeout(resolve, 20));
  rmSync(projectBasePath, { recursive: true, force: true });
});

describe('function logger', () => {
  it('creates the logs folder at construction and both empty log files without any message being written', async () => {
    loggerAt(projectBasePath);

    expect(existsSync(join(projectBasePath, 'logs'))).toBe(true);
    await eventually(() => fileNames().length === 2);
    expect(fileNames()).toEqual(['error.log', 'info.log']);
    expect(read('error.log')).toBe('');
    expect(read('info.log')).toBe('');
  });

  it('writes an error to logs/error.log as a json line and prints it coloured on stdout', async () => {
    const logger = loggerAt(projectBasePath);

    logger.log('Invalid port number.', 'error');

    await eventually(() => read('error.log') !== '');
    expect(read('error.log')).toBe('{"level":"error","message":"Invalid port number."}\n');
    expect(read('info.log')).toBe('');
    expect(stdout).toEqual(['\u001b[31merror: Invalid port number.\u001b[39m\n']);
  });

  it('writes info and warn to logs/info.log, never to error.log, and drops debug everywhere', async () => {
    const logger = loggerAt(projectBasePath);

    logger.log('first', 'info');
    logger.log('second', 'warn');
    logger.log('third', 'debug');

    await eventually(() => read('info.log').split('\n').length === 3);
    expect(read('info.log')).toBe('{"level":"info","message":"first"}\n{"level":"warn","message":"second"}\n');
    expect(read('error.log')).toBe('');
    expect(stdout).toEqual(['\u001b[32minfo: first\u001b[39m\n', '\u001b[33mwarn: second\u001b[39m\n']);
  });

  it('configures each file transport with the v1 path, level and rotation settings', () => {
    const { info, error } = winstonLoggers(loggerAt(projectBasePath));

    expect(fileTransport(info)).toMatchObject({
      dirname: join(projectBasePath, 'logs'),
      filename: 'info.log',
      level: 'info',
      maxFiles: 20,
      tailable: true,
      maxsize: 1000000,
    });
    expect(fileTransport(error)).toMatchObject({
      dirname: join(projectBasePath, 'logs'),
      filename: 'error.log',
      level: 'error',
      maxFiles: 20,
      tailable: true,
      maxsize: 1000000,
    });
  });

  it('gives the info logger the warn, info and debug levels and the error logger the error level alone', () => {
    const { info, error } = winstonLoggers(loggerAt(projectBasePath));

    expect(info.levels).toEqual({ warn: 1, info: 2, debug: 3 });
    expect(error.levels).toEqual({ error: 0 });
    expect(consoleTransport(info).level).toBeUndefined();
    expect(consoleTransport(error).level).toBe('error');
  });

  it('normalises a base path containing parent segments', () => {
    const { info } = winstonLoggers(loggerAt(join(projectBasePath, 'nested', '..')));

    expect(fileTransport(info).dirname).toBe(join(projectBasePath, 'logs'));
  });

  it('prints the invalid base path error and exits 1 when the base path does not exist', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const missing = join(projectBasePath, 'no-such-dir');

    expect(() => new Logger({ projectBasePath: missing })).toThrow('exit 1');

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stdout).toEqual(['\u001b[31merror: Provided base path is not valid\u001b[39m\n']);
    expect(existsSync(missing)).toBe(false);
  });

  it('prints any other log type through cliux with its print options', () => {
    const print = jest.spyOn(cliux, 'print').mockImplementation(() => undefined);
    const logger = loggerAt(projectBasePath);

    logger.log('plain');
    logger.log('coloured', { color: 'green' });

    expect(print.mock.calls).toEqual([
      ['plain', {}],
      ['coloured', { color: 'green' }],
    ]);
    expect(stdout).toEqual([]);
  });

  it('redacts the sixteen characters after an authtoken blt prefix in an object', () => {
    const logger = loggerAt(projectBasePath);
    const secret = randomBytes(8).toString('hex');

    expect(logger.returnString({ authtoken: `blt${secret}tail`, other: 1 })).toBe('{"authtoken":"blt....tail","other":1}');
  });

  it('redacts every authtoken inside the objects of an array and joins the items with two spaces', () => {
    const logger = loggerAt(projectBasePath);
    const first = randomBytes(8).toString('hex');
    const second = randomBytes(8).toString('hex');

    const text = logger.returnString(['  start', { authtoken: `blt${first}` }, [{ authtoken: `blt${second}` }], null, 'end  ']);

    expect(text).toBe('start  {"authtoken":"blt...."}  [{"authtoken":"blt...."}]    end');
  });

  it('strips ansi escapes from a string and trims it', () => {
    const logger = loggerAt(projectBasePath);

    expect(logger.returnString('  \u001b[31mred\u001b[39m and \u001b]8;;https://x.test\u0007link\u001b]8;;\u0007  ')).toBe('red and link');
  });

  it('strips ansi escapes from the joined text of an array', () => {
    const logger = loggerAt(projectBasePath);

    expect(logger.returnString(['\u001b[1mbold\u001b[22m', 'plain'])).toBe('bold  plain');
  });

  it('stringifies an empty array rather than joining it', () => {
    const logger = loggerAt(projectBasePath);

    expect(logger.returnString([])).toBe('[]');
  });

  it('renders primitives as lodash toString did', () => {
    const logger = loggerAt(projectBasePath);

    expect(logger.returnString(42)).toBe('42');
    expect(logger.returnString(-0)).toBe('-0');
    expect(logger.returnString(false)).toBe('false');
    expect(logger.returnString(null)).toBe('');
    expect(logger.returnString(undefined)).toBe('');
  });

  it('returns an object it cannot stringify unchanged', () => {
    const logger = loggerAt(projectBasePath);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const fn = () => 'x';

    expect(logger.returnString(circular)).toBe(circular);
    expect(logger.returnString(fn)).toBe(fn);
    expect(logger.returnString(['a', circular])).toBe('a  [object Object]');
  });

  it('writes the cleaned text to the log file', async () => {
    const logger = loggerAt(projectBasePath);
    const secret = randomBytes(8).toString('hex');

    logger.log(['\u001b[31mfailed\u001b[39m', { authtoken: `blt${secret}` }], 'error');

    await eventually(() => read('error.log') !== '');
    expect(read('error.log')).toBe('{"level":"error","message":"failed  {\\"authtoken\\":\\"blt....\\"}"}\n');
  });
});
